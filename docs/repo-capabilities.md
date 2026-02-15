# TaxiTeamEUBackend — Capabilities & API Reference

## Overview
- Stack: NestJS (TypeScript), Socket.IO, Postgres (`pg`), Twilio (OTP), TomTom (maps).
- Main entry: `src/main.ts`. Modules registered in `src/app.module.ts` include `auth`, `users`, `maps`, `ride`, `drivers`, `driver-location`, `socket`.

## How to run (local)
1. Install deps: `npm install`
2. Start dev server: `npm run start:dev`
3. Run tests: `npm run test` (unit) / `npm run test:e2e` (integration)

## Environment (see `.env.example`)
- `DB_*`, `JWT_SECRET`, `JWT_REFRESH_EXPIRES`, `TWILIO_*`, `TOMTOM_API_KEY`, `PORT`.

## REST API Endpoints

Auth
- POST /auth/otp/request
  - Body: { phone: "+<E.164>" }
  - Response: { success: true, expires_in_seconds: 60 }

- POST /auth/otp/verify
  - Body: { phone: "+<E.164>", otp: "123456" }
  - Response: { accessToken, refreshToken, user }

- POST /auth/refresh
  - Body: { refresh_token: string }
  - Response: { access_token }

- POST /auth/logout
  - Header: `Authorization: Bearer <accessToken>` (optional)
  - Response: { success: true }

- GET /auth/me
  - Auth: Bearer JWT (JwtAuthGuard)
  - Response: { message: 'You are authenticated', user }

Users
- PATCH /users/onboarding
  - Auth: Bearer JWT
  - Body: onboarding fields (see `src/users/dto/onboarding.dto.ts`)
  - Response: { user }

- PATCH /users/profile
  - Auth: Bearer JWT
  - Body: profile fields (see `src/users/dto/update-profile.dto.ts`)
  - Response: { user }

Maps
- GET /maps/search?query=...&limit=6
  - Returns array of matching places (title, address, lat, lng)

- POST /maps/reverse-geocode
  - Body: { lat: number, lng: number }
  - Returns: { address }

- POST /maps/estimate
  - Body: { pickupLat, pickupLng, dropLat, dropLng }
  - Returns: { distanceKm, durationMin, routePoints, fareByRideType }

Rides (core flows)
- POST /ride/create
  - Auth: Rider (JWT)
  - Body: pickup/drop coords, vehicle_type, estimated_fare, etc.
  - Response: { rideId, status: 'SEARCHING_DRIVER', message }
  - Behavior: Creates ride row, inserts ride_events, finds nearest drivers (in-memory via `DriverLocationService` + DB eligibility), starts sequential dispatch.

- POST /ride/accept
  - Auth: Driver (JWT)
  - Body: { rideId }
  - Response: { success: true, otp: "1234", expiresIn: 300 } or throws BadRequest for invalid states
  - Behavior: Transactionally marks dispatch row ACCEPTED, sets ride.driver_id and status DRIVER_ASSIGNED. Generates 4-digit OTP, stores in-memory with expiry (5 min default). Notifies rider via WebSocket event `RIDE_ACCEPTED_WITH_OTP` with payload { rideId, driverId, otp, expiresIn }.

- POST /ride/arrived
  - Auth: Driver
  - Body: { rideId }
  - Response: { success: true, message }

- POST /ride/start
  - Auth: Driver
  - Body: { rideId, otpCode: "1234" }
  - Response: { success: true, message } or throws BadRequest if OTP invalid/expired
  - Behavior: Validates OTP against in-memory store, clears OTP record, marks ride status ONGOING, notifies rider via WebSocket.

- POST /ride/complete
  - Auth: Driver
  - Body: { rideId, finalFare? }
  - Response: completed ride details (updated DB row)

- POST /ride/cancel
  - Auth: Driver or Rider
  - Body: { rideId }
  - Response: result of `cancelRideByDriver` or `cancelRideByRider`

Notes: All ride operations use DB transactions (manual client locks) and insert `ride_events` for audit.

## WebSocket (Socket.IO) — `SocketGateway` (src/socket/socket.gateway.ts)

Handshake
- Clients must send a JWT in the auth handshake token: `client.handshake.auth.token = '<JWT>'`.
- JWT is verified via `JwtService.verify()`; on success `client.data.user = { userId, role }`.
- CORS allowed origins: `http://localhost:4937`,`http://localhost:4937`, `http://localhost:3000` (config in gateway).

Server maintains two maps: `driverSockets: Map<userId, socketId>` and `riderSockets: Map<userId, socketId>`.

Client -> Server events
- `DRIVER_LOCATION_UPDATE` { lat:number, lng:number }
  - Sent by drivers. Gateway authenticates and calls `DriverLocationService.updateLocation(userId, lat, lng)` which updates in-memory driver map and snapshots periodically to DB.

- `DRIVER_ACCEPT_RIDE` { rideId }
  - When received from driver, gateway responds with `DRIVER_ACCEPT_RIDE_INFO` telling the client to use HTTP `POST /ride/accept` to accept rides (websockets used for notifications only).

Server -> Client events (examples used by NotificationsService)
- `NEW_RIDE_REQUEST` — payload: { rideId } — sent to driver when dispatching.
- `RIDE_ASSIGNED` — payload: { rideId, driverId } — sent to rider when a driver accepts.
- `RIDE_ACCEPTED_WITH_OTP` — payload: { rideId, driverId, otp, expiresIn } — sent to rider after driver accepts with OTP for verification.
- Other events emitted via `SocketGateway.sendToDriver/sendToRider` with custom event names.

Implementation details
- NotificationsService is the app-level helper that calls `SocketGateway.sendToDriver` / `sendToRider` to emit events.
- Driver location updates are stored in `DriverLocationService.drivers` (Map) with TTL-based cleanup and periodic DB snapshot.
- Ride OTP verification: `RideOtpService.otpStore` maintains in-memory map `Map<rideId, { otp, driverId, riderId, generatedAt, expiresAt }>`. OTPs are 4-digit strings with 5-min expiry. Entries are deleted on OTP validation or ride completion/cancellation.

## Ride dispatch flow (sequential dispatch)
1. Rider calls `POST /ride/create` with pickup/drop and vehicle type.
2. `RideService.createRide` inserts ride row (status `SEARCHING_DRIVER`) and finds nearest drivers:
   - Gets active driver IDs from `DriverLocationService.getActiveDrivers()` (in-memory)
   - Filters DB drivers by `is_available` and `vehicle_type`
   - Calculates Haversine distance and picks nearest N drivers (default 5)
3. `RideService.startDispatch` begins sequential dispatch: picks first driver, inserts `ride_driver_dispatch` row with status `REQUESTED`, sets `drivers.has_pending_request = true`, and calls `NotificationsService.notifyDriver(driverId, 'NEW_RIDE_REQUEST', { rideId })`.
4. Driver receives `NEW_RIDE_REQUEST` over websocket (if connected). Driver should call `POST /ride/accept` to accept.
5. If driver doesn't respond within configured timeout (`DISPATCH_CONFIG.responseTimeoutSec`), `RideService` marks dispatch row `TIMEOUT`, clears pending flag, and tries the next driver.
6. On accept (driver calls `POST /ride/accept`): `RideService.handleDriverAccept` runs a DB transaction:
   - Validates ride is `SEARCHING_DRIVER`, lock rows, updates dispatch status to `ACCEPTED`, marks ride `DRIVER_ASSIGNED`, sets driver flags, inserts `ride_events`, commits.
   - Generates 4-digit OTP, stores in-memory map `rideId -> { otp, driverId, riderId, generatedAt, expiresAt }` with 5-min expiry.
   - Calls `NotificationsService.notifyRider(riderId, 'RIDE_ACCEPTED_WITH_OTP', { rideId, driverId, otp, expiresIn })` via WebSocket.
   - Calls driver behaviour hooks.
7. Rider sees OTP on screen, shares verbally with driver.
8. Driver calls `POST /ride/start` with `{ rideId, otpCode: "1234" }`:
   - Validates OTP from in-memory store (must match and not be expired).
   - Clears OTP record from memory, marks ride `ONGOING`, notifies rider.
9. Driver proceeds to pickup and uses `POST /ride/arrived`, `POST /ride/complete` for lifecycle updates. Each action updates DB and uses `notificationsService` to inform the rider.
10. On ride completion, cancellation, or timeout: OTP record is automatically cleaned up from memory.

## Tips for integration
- Use `Authorization: Bearer <accessToken>` for protected endpoints. Access tokens are standard JWTs signed by `JwtService.sign`.
- For sockets: set `auth: { token: '<JWT>' }` when connecting with Socket.IO client.
- Keep OTP phone numbers in E.164 format (see `RequestOtpDto` validation).

## Next steps / Gaps to document
- Add `.env.example` (already present) and a README section listing required DB schema and migrations.
- Add example request/response JSON samples for each endpoint (I can expand upon request).

