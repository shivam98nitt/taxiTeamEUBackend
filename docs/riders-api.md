# Riders API Reference

## Overview
This document covers all REST and WebSocket endpoints available to riders in the TaxiTeamEU backend.

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
Logout the current user (optional JWT required).
- **Header:** `Authorization: Bearer <accessToken>` (optional)
- **Response:** `{ success: true }`
- **Auth:** Optional JWT

#### GET /auth/me
Get authenticated rider information.
- **Auth:** Bearer JWT (JwtAuthGuard)
- **Response:** `{ message: 'You are authenticated', user }`

---

### User Profile

#### PATCH /users/onboarding
Complete rider onboarding.
- **Auth:** Bearer JWT
- **Body:** Onboarding fields (see `src/users/dto/onboarding.dto.ts`)
- **Response:** `{ user }`

#### PATCH /users/profile
Update rider profile information.
- **Auth:** Bearer JWT
- **Body:** Profile fields (see `src/users/dto/update-profile.dto.ts`)
- **Response:** `{ user }`

---

### Maps (Shared)

#### GET /maps/search?query=...&limit=6
Search for places by query string.
- **Query Params:**
  - `query` (string): Search query
  - `limit` (number, default 6): Max results
- **Response:** Array of places `[{ title, address, lat, lng }, ...]`
- **Auth:** None

#### POST /maps/reverse-geocode
Convert coordinates to address.
- **Body:** `{ lat: number, lng: number }`
- **Response:** `{ address }`
- **Auth:** None

#### POST /maps/estimate
Get ride estimates (distance, duration, fare).
- **Body:** `{ pickupLat, pickupLng, dropLat, dropLng }`
- **Response:** `{ distanceKm, durationMin, routePoints, fareByRideType }`
- **Auth:** None

---

### Ride Operations

#### POST /ride/create
Create a new ride request.
- **Auth:** Rider (Bearer JWT)
- **Body:**
  ```json
  {
    "pickupLat": number,
    "pickupLng": number,
    "dropLat": number,
    "dropLng": number,
    "vehicle_type": "ECONOMY" | "COMFORT" | "PREMIUM",
    "estimated_fare": number
  }
  ```
- **Response:**
  ```json
  {
    "rideId": string,
    "status": "SEARCHING_DRIVER",
    "message": "Searching for nearest drivers"
  }
  ```
- **Behavior:**
  - Creates ride row with status `SEARCHING_DRIVER`
  - Inserts ride_events for audit
  - Finds nearest drivers based on location and availability
  - Starts sequential dispatch process
  - Notifies available drivers via WebSocket

#### POST /ride/start
Start the ride after driver arrival and OTP verification.
- **Auth:** Bearer JWT (Rider initiates, but driver provides OTP)
- **Body:**
  ```json
  {
    "rideId": string,
    "otpCode": "1234"
  }
  ```
- **Response:** `{ success: true, message: "Ride started" }` or throws BadRequest if OTP invalid/expired
- **Behavior:**
  - Validates OTP against in-memory store (4-digit, 5-min expiry)
  - Clears OTP record from memory
  - Marks ride status as `ONGOING`
  - Notifies rider and driver via WebSocket

#### POST /ride/cancel
Cancel an active ride as a rider.
- **Auth:** Bearer JWT (Rider)
- **Body:** `{ rideId: string }`
- **Response:** Result of cancellation process
- **Behavior:**
  - Validates ride belongs to authenticated rider
  - Updates ride status to `CANCELLED`
  - Notifies driver of cancellation
  - Cleans up OTP records if applicable

---

## WebSocket Events (Socket.IO)

### Connection & Authentication

**Handshake:**
- Send JWT in auth handshake: `auth: { token: '<JWT>' }`
- JWT is verified via `JwtService.verify()`
- On success, client.data.user is set with `{ userId, role }`
- Role must be `'rider'`

**CORS:**
- Allowed origins: `http://localhost:4937`, `http://localhost:3000`

---

### Server → Client Events (Rider Receives)

#### NEW_RIDE_REQUEST
Sent when a driver accepts the ride.
- **Payload:**
  ```json
  {
    "rideId": string,
    "driverId": string,
    "driverName": string,
    "driverPhone": string,
    "vehicleInfo": {
      "make": string,
      "model": string,
      "licensePlate": string
    }
  }
  ```
- **When:** After driver accepts the ride

#### RIDE_ACCEPTED_WITH_OTP
Sent after a driver accepts with OTP for verification.
- **Payload:**
  ```json
  {
    "rideId": string,
    "driverId": string,
    "otp": "1234",
    "expiresIn": 300
  }
  ```
- **When:** Immediately after driver accepts ride
- **Note:** Share OTP with driver verbally

#### RIDE_ASSIGNED
Sent when ride is assigned to a driver.
- **Payload:**
  ```json
  {
    "rideId": string,
    "driverId": string
  }
  ```
- **When:** Driver accepted and ride status updated

#### DRIVER_ARRIVED
Sent when driver has arrived at pickup location.
- **Payload:**
  ```json
  {
    "rideId": string,
    "driverId": string,
    "message": "Driver has arrived"
  }
  ```
- **When:** Driver sends arrival notification

#### RIDE_ONGOING
Sent when ride is started (after OTP verification).
- **Payload:**
  ```json
  {
    "rideId": string,
    "driverId": string,
    "status": "ONGOING"
  }
  ```
- **When:** Driver verifies OTP and starts ride

#### RIDE_COMPLETED
Sent when ride is completed by driver.
- **Payload:**
  ```json
  {
    "rideId": string,
    "finalFare": number,
    "completedAt": timestamp,
    "message": "Your ride has been completed"
  }
  ```
- **When:** Driver marks ride as complete

#### RIDE_CANCELLED
Sent when ride is cancelled by driver or system.
- **Payload:**
  ```json
  {
    "rideId": string,
    "reason": string,
    "message": "Ride has been cancelled"
  }
  ```
- **When:** Driver cancels or system timeout occurs

#### DRIVER_LOCATION_UPDATE
Sent periodically with driver's live location (if opted in).
- **Payload:**
  ```json
  {
    "rideId": string,
    "driverId": string,
    "lat": number,
    "lng": number,
    "timestamp": timestamp
  }
  ```
- **When:** Driver sends location updates during ride

---

### Client → Server Events (Rider Sends)

None currently defined. Riders listen to server events and use REST API for actions.

---

## Implementation Notes

1. **JWT Format:** Use `Authorization: Bearer <accessToken>` header for protected REST endpoints
2. **WebSocket Auth:** Set `auth: { token: '<JWT>' }` during Socket.IO connection
3. **Phone Format:** E.164 format required (e.g., `+1234567890`)
4. **OTP Validity:** 4-digit codes expire after 5 minutes
5. **Ride Status Flow:** `SEARCHING_DRIVER` → `DRIVER_ASSIGNED` → `ONGOING` → `COMPLETED` or `CANCELLED`
6. **Error Handling:** All endpoints return appropriate HTTP status codes and error messages
