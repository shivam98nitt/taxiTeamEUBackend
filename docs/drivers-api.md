# Drivers API Reference

## Overview
This document covers all REST and WebSocket endpoints available to drivers in the TaxiTeamEU backend.

---

## REST API Endpoints

### Authentication

#### POST /auth/otp/request
Request an OTP for phone-based authentication.
- **Body:** `{ phone: "+<E.164>" }`
- **Response:** `{ success: true, expires_in_seconds: 60 }`
- **Auth:** None

#### POST /auth/otp/verify
Verify OTP and receive JWT tokens.
- **Body:** `{ phone: "+<E.164>", otp: "123456" }`
- **Response:** `{ accessToken, refreshToken, user }`
- **Auth:** None

#### POST /auth/refresh
Refresh the access token using a refresh token.
- **Body:** `{ refresh_token: string }`
- **Response:** `{ access_token }`
- **Auth:** None

#### POST /auth/logout
Logout the current driver (optional JWT required).
- **Header:** `Authorization: Bearer <accessToken>` (optional)
- **Response:** `{ success: true }`
- **Auth:** Optional JWT

#### GET /auth/me
Get authenticated driver information.
- **Auth:** Bearer JWT (JwtAuthGuard)
- **Response:** `{ message: 'You are authenticated', user }`

---

### User Profile

#### PATCH /users/onboarding
Complete driver onboarding (vehicle details, documents, etc.).
- **Auth:** Bearer JWT
- **Body:** Onboarding fields (see `src/users/dto/onboarding.dto.ts`)
- **Response:** `{ user }`

#### PATCH /users/profile
Update driver profile information.
- **Auth:** Bearer JWT
- **Body:** Profile fields (see `src/users/dto/update-profile.dto.ts`)
- **Response:** `{ user }`

---

### Maps (Shared)

#### GET /maps/search?query=...&limit=6
Search for places by query string (for navigation purposes).
- **Query Params:**
  - `query` (string): Search query
  - `limit` (number, default 6): Max results
- **Response:** Array of places `[{ title, address, lat, lng }, ...]`
- **Auth:** None

#### POST /maps/reverse-geocode
Convert coordinates to address (for current location).
- **Body:** `{ lat: number, lng: number }`
- **Response:** `{ address }`
- **Auth:** None

#### POST /maps/estimate
Get ride route information (distance, duration, etc.).
- **Body:** `{ pickupLat, pickupLng, dropLat, dropLng }`
- **Response:** `{ distanceKm, durationMin, routePoints, fareByRideType }`
- **Auth:** None

---

### Ride Operations

#### POST /ride/accept
Accept a ride request as a driver.
- **Auth:** Bearer JWT (Driver)
- **Body:**
  ```json
  {
    "rideId": string
  }
  ```
- **Response:**
  ```json
  {
    "success": true,
    "otp": "1234",
    "expiresIn": 300
  }
  ```
- **Throws:** BadRequest if ride is not in `SEARCHING_DRIVER` state or driver is not eligible
- **Behavior:**
  - Validates ride exists and is in `SEARCHING_DRIVER` state
  - Runs transactional DB operations with row locks
  - Updates dispatch row status to `ACCEPTED`
  - Sets ride.driver_id and marks ride `DRIVER_ASSIGNED`
  - Generates 4-digit OTP and stores in-memory with 5-min expiry
  - Notifies rider via WebSocket with `RIDE_ACCEPTED_WITH_OTP` event containing OTP
  - Inserts ride_events for audit trail
  - Triggers driver behaviour hooks

#### POST /ride/arrived
Notify that driver has arrived at pickup location.
- **Auth:** Bearer JWT (Driver)
- **Body:**
  ```json
  {
    "rideId": string
  }
  ```
- **Response:** `{ success: true, message: "Driver arrived at pickup" }`
- **Behavior:**
  - Validates ride belongs to authenticated driver
  - Updates ride status to `ARRIVED`
  - Notifies rider via WebSocket

#### POST /ride/start
Start the ride after passenger gets in (requires OTP verification).
- **Auth:** Bearer JWT (Driver)
- **Body:**
  ```json
  {
    "rideId": string,
    "otpCode": "1234"
  }
  ```
- **Response:** `{ success: true, message: "Ride started" }` or throws BadRequest if OTP invalid/expired
- **Behavior:**
  - Validates OTP against in-memory store (must match and not be expired)
  - Clears OTP record from memory
  - Marks ride status as `ONGOING`
  - Notifies rider via WebSocket with `RIDE_ONGOING` event
  - Inserts ride_events for audit

#### POST /ride/complete
Mark ride as completed.
- **Auth:** Bearer JWT (Driver)
- **Body:**
  ```json
  {
    "rideId": string,
    "finalFare": number
  }
  ```
- **Response:** Completed ride details (updated DB row)
- **Behavior:**
  - Validates ride belongs to authenticated driver
  - Updates ride status to `COMPLETED`
  - Records final fare amount
  - Cleans up OTP records
  - Notifies rider of completion
  - Inserts ride_events

#### POST /ride/cancel
Cancel an active ride as a driver.
- **Auth:** Bearer JWT (Driver)
- **Body:**
  ```json
  {
    "rideId": string
  }
  ```
- **Response:** Result of cancellation process
- **Behavior:**
  - Validates ride belongs to authenticated driver
  - Updates ride status to `CANCELLED`
  - Notifies rider of cancellation
  - Cleans up OTP records
  - Resets dispatch for other drivers if applicable

---

## WebSocket Events (Socket.IO)

### Connection & Authentication

**Handshake:**
- Send JWT in auth handshake: `auth: { token: '<JWT>' }`
- JWT is verified via `JwtService.verify()`
- On success, client.data.user is set with `{ userId, role }`
- Role must be `'driver'`

**CORS:**
- Allowed origins: `http://localhost:4937`, `http://localhost:3000`

**Server maintains:** `driverSockets: Map<userId, socketId>`

---

### Client → Server Events (Driver Sends)

#### DRIVER_LOCATION_UPDATE
Send driver's current location (typically sent in intervals).
- **Emit:**
  ```json
  {
    "lat": number,
    "lng": number
  }
  ```
- **Server Response:** Acknowledged and processed
- **Behavior:**
  - Gateway authenticates driver
  - Calls `DriverLocationService.updateLocation(userId, lat, lng)`
  - Updates in-memory driver location map
  - Snapshot periodic locations to DB
  - Used for finding nearest drivers for ride requests

#### DRIVER_ACCEPT_RIDE
Notify server that driver is accepting a ride (informational, actual acceptance via REST).
- **Emit:**
  ```json
  {
    "rideId": string
  }
  ```
- **Server Response:** `DRIVER_ACCEPT_RIDE_INFO`
  ```json
  {
    "message": "Use HTTP POST /ride/accept to complete acceptance"
  }
  ```
- **Note:** WebSockets used for notifications only; REST API used for actions

---

### Server → Client Events (Driver Receives)

#### NEW_RIDE_REQUEST
Sent when a new ride request is available for dispatch.
- **Payload:**
  ```json
  {
    "rideId": string,
    "riderName": string,
    "pickupLat": number,
    "pickupLng": number,
    "dropLat": number,
    "dropLng": number,
    "distanceKm": number,
    "estimatedFare": number,
    "vehicleType": "ECONOMY" | "COMFORT" | "PREMIUM"
  }
  ```
- **When:** Ride is dispatched to this driver by system
- **Action Required:** Driver should call `POST /ride/accept` within response timeout (default configured)
- **Timeout Behavior:** If no response within configured seconds, system moves to next driver

#### RIDE_DISPATCH_TIMEOUT
Sent when a previously dispatched ride request times out (not accepted in time).
- **Payload:**
  ```json
  {
    "rideId": string,
    "message": "Ride request timeout. System will try another driver."
  }
  ```
- **When:** Driver doesn't respond to NEW_RIDE_REQUEST in time

#### RIDE_ASSIGNED_CONFIRMATION
Confirmation that your acceptance of ride was successful.
- **Payload:**
  ```json
  {
    "rideId": string,
    "riderId": string,
    "riderName": string,
    "pickupAddress": string,
    "dropAddress": string,
    "message": "You have been assigned this ride"
  }
  ```
- **When:** After REST `POST /ride/accept` succeeds

#### RIDE_CANCELLED
Sent when rider cancels the ride.
- **Payload:**
  ```json
  {
    "rideId": string,
    "reason": string,
    "message": "Ride has been cancelled by rider"
  }
  ```
- **When:** Rider initiates cancellation

#### RIDE_COMPLETION_CONFIRMATION
Confirmation that ride was successfully completed.
- **Payload:**
  ```json
  {
    "rideId": string,
    "finalFare": number,
    "completedAt": timestamp,
    "riderReview": {
      "rating": number,
      "comment": string
    }
  }
  ```
- **When:** After REST `POST /ride/complete` succeeds

---

## Driver Behavior Hooks

When a driver accepts a ride, behavior hooks are triggered:
- Driver behaviour services can be registered in `src/drivers/driver-behaviour.services.ts`
- Used for analytics, incentives, performance tracking, etc.

---

## Implementation Notes

1. **JWT Format:** Use `Authorization: Bearer <accessToken>` header for protected REST endpoints
2. **WebSocket Auth:** Set `auth: { token: '<JWT>' }` during Socket.IO connection
3. **Phone Format:** E.164 format required (e.g., `+1234567890`)
4. **Location Updates:** Send `DRIVER_LOCATION_UPDATE` periodically to maintain active driver status
5. **OTP Handling:** Your app receives OTP from rider verbally; use `POST /ride/start` with this OTP
6. **OTP Validity:** 4-digit codes expire after 5 minutes
7. **Ride Status Flow:** `SEARCHING_DRIVER` (receive NEW_RIDE_REQUEST) → `DRIVER_ASSIGNED` (post /ride/accept) → `ONGOING` (post /ride/start) → `COMPLETED` or `CANCELLED`
8. **Dispatch Timeout:** Default timeout is configured in `DISPATCH_CONFIG.responseTimeoutSec`; respond quickly to ride requests
9. **Driver Status:** Must have `is_available = true` and matching `vehicle_type` to receive dispatches
10. **Error Handling:** All endpoints return appropriate HTTP status codes and error messages

---

## Example Driver Flow

1. Driver logs in via OTP
2. Driver app sends `DRIVER_LOCATION_UPDATE` regularly
3. Driver receives `NEW_RIDE_REQUEST` via WebSocket
4. Driver calls `POST /ride/accept` (REST) with rideId
5. Driver gets `RIDE_ASSIGNED_CONFIRMATION` via WebSocket with rider details
6. Driver navigates to pickup location (uses `/maps/estimate` for route)
7. When arrived, driver calls `POST /ride/arrived` (REST)
8. Rider arrives at vehicle, shares OTP verbally
9. Driver calls `POST /ride/start` (REST) with OTP
10. Driver drives to dropoff location
11. Driver calls `POST /ride/complete` (REST) with final fare
12. Driver receives `RIDE_COMPLETION_CONFIRMATION` via WebSocket
13. Continue accepting new rides...
