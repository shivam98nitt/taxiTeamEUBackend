**Repo Overview**
- **Stack:** NestJS (TypeScript), Socket.IO, Postgres client (`pg`), Twilio for SMS/OTP.
- **Main entry:** [src/main.ts](src/main.ts) — standard Nest bootstrap.
- **Key modules:** `auth`, `users`, `socket`, `driver-location`, `ride`, `maps`, `drivers`, `database` (see [src/app.module.ts](src/app.module.ts)).

**Architecture & Data Flow**
- The app is modular: each feature lives under `src/<feature>/` with `*.module.ts`, `*.controller.ts`, `*.service.ts` and `dto/` for request/response shapes.
- Real-time events flow through the WebSocket gateway at [src/socket/socket.gateway.ts](src/socket/socket.gateway.ts). The gateway uses JWTs carried in `client.handshake.auth.token` and sets `client.data.user` for downstream handlers.
- Driver location updates call `DriverLocationService.updateLocation()` (see [src/driver-location/driver-location.service.ts](src/driver-location/driver-location.service.ts)). Use `SocketGateway.sendToDriver()` / `sendToRider()` to emit to specific users.

**What to look for when changing behavior**
- Auth: JWT usage and guards live in `src/auth/` (HTTP + WS guards). For websocket auth, inspect `src/auth/guards/ws-jwt-auth.guard.ts` and how `SocketGateway` expects `client.data.user`.
- Throttling is configured in [src/app.module.ts](src/app.module.ts) via `ThrottlerModule` — respect global limits when adding public endpoints.
- Database access is centralized in `src/database/` — prefer injecting `DatabaseModule` services rather than direct DB clients in controllers.

**Conventions & Patterns**
- DTOs live under `src/**/dto/*.dto.ts` and use `class-validator` + `class-transformer` for validation and sanitization.
- Unit/e2e tests live next to source files as `*.spec.ts`. Run with `npm run test` (unit) and `npm run test:e2e` (e2e).
- Scripts: see `package.json` — common commands:
  - `npm run start:dev` — local dev with watch
  - `npm run build` && `npm run start:prod` — production flow
  - `npm run lint` and `npm run format`

**WebSocket specifics (important examples)**
- Authentication: gateway expects a JWT at `client.handshake.auth.token`. The guard/verify path uses `JwtService.verify()` (see [src/socket/socket.gateway.ts](src/socket/socket.gateway.ts)).
- Events observed in the gateway:
  - `DRIVER_LOCATION_UPDATE` -> body `{ lat:number, lng:number }` — updates driver location service.
  - `DRIVER_ACCEPT_RIDE` -> gateway responds with `DRIVER_ACCEPT_RIDE_INFO` and suggests using the HTTP `POST /ride/accept` endpoint.
- Socket maps: `SocketGateway` tracks `riderSockets` and `driverSockets` maps (userId -> socketId). When emitting to a user use `server.to(socketId).emit(event, payload)` via helpers `sendToDriver()` / `sendToRider()`.

**Testing & Debugging Notes**
- To run tests: `npm run test` (unit) and `npm run test:e2e` (e2e). Jest config is in `package.json` (root) and `test/jest-e2e.json`.
- To debug Jest with ts-node paths, use the `test:debug` script which loads `tsconfig-paths`.

**Where to add new features**
- Add a new module under `src/<feature>/` with `module`, `controller`, `service`, `dto` and register the module in [src/app.module.ts](src/app.module.ts).
- For realtime flows: add socket handlers in `SocketGateway` or create a new gateway provider and export it via a module. Reuse `AuthModule` and guards for consistent auth state.

**Integration & External deps**
- Primary external services in code:
  - Postgres client: `pg` (database access)
  - Twilio: used for OTP flows in `src/auth/dto` and `auth.service.ts`.
  - Socket.IO + `@nestjs/platform-socket.io` for websockets.
- Credentials/config live via `@nestjs/config` (global ConfigModule). Check environment expectations in `src/database/database.module.ts` and `src/config/`.

**Style & Safety**
- Follow existing patterns: prefer DI (constructor injection) over importing singletons. Keep controllers thin and move logic to services.
- Avoid performing critical state changes solely over websockets — the project uses HTTP endpoints for authoritative changes (example: ride acceptance).

If anything here is unclear or you want me to include more examples (e.g., typical DB queries, example HTTP endpoints, or socket client snippets), tell me which area to expand and I will iterate.
