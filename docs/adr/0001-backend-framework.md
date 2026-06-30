# ADR 0001: Backend Framework Direction

## Status

Accepted

## Context

Mnemosyne needs a backend that can validate shared TypeScript schemas, expose public APIs, run internal services, support queues, and stay close to the existing package model. The roadmap needs real persistence soon, so service conventions should be locked before route handlers multiply.

## Decision

Use a TypeScript Node backend with Fastify-style service boundaries for the first production API. Keep domain logic in packages and keep route handlers thin. Each route validates input and output with shared schema contracts, emits a learning or audit event, and delegates graph, scheduler, assessment, sleep, video, and governance behavior to package-level services.

## Consequences

- The web app, API service, and workers can share types and validation rules.
- Domain packages remain testable without HTTP.
- Fastify-compatible handlers leave room for deployment on containers, serverless adapters, or long-running services.
- Future services can split out when load or isolation demands it without changing the core model.
