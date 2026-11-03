# Swarm Capstone — Spike Concept

*Working title. Captured 2026-09-30. Sequenced after the messaging and AI spikes close.*

## The concept

A swarm of drones moves through a 3D world. The swarm is organized into **clusters**: small squads where each drone carries different capabilities (camera, thermal, interaction, and so on). Every cluster exposes one interface with two halves:

- **Feedback:** what its sensors observe.
- **Commands:** what it can do, such as survey, take a picture, interact, hold, or engage.

Each cluster is commanded by an **agentic harness** that holds the cluster's interface the way a player holds a controller, and is taught by a **skill**: a playbook of how to act under given conditions.

The whole system is visualized by tapping the message stream and rendering the swarm's **combined perception** as a live 3D map, either natively or in the browser through three.js.

It evolves the C2 distributed-session concept and Sovereign Grid's cellular world into three dimensions, at higher cube resolution, with real agents in command.

## Why it's the capstone

It pulls every Standards Lab layer into one scenario:

| Layer | What the capstone demands of it |
|---|---|
| Messaging | A live, high-volume sensor stream plus a durable, audited event log |
| AI | Many concurrent harness sessions acting as real commanders |
| Auth | Distinct principals, scoped permissions, signed delegation |
| Client | A real-time 3D viewer fed directly from the stream |

If the architecture holds here, it holds.

## Settled intent

### Agents command RTS-style

The agent is a commander, not a pilot. Harness turns take seconds, so each cluster runs a deterministic **autopilot of behaviors** (transit, hold, orbit, survey, return), and the agent's commands select and parameterize those behaviors. Discrete actions, like taking a picture, are queued to the cluster. Decision latency is accepted by design. The skill teaches *when to change behavior*, not how to fly.

### The view is perception, not reality

The viewer renders **only what the sensors pick up**. It's a 3D navigation map, something like Google Maps, with a real-time sensor overlay, not a realistic world being monitored remotely.

- **The base map is a prior.** Terrain, elevation and known features are static, trusted context, loaded once.
- **The overlay is what's observed.** High-resolution cubes form an occupancy grid built from sensor returns: a cube exists because something was detected there, at the resolution the sensor could resolve.
- **Where no drone has looked, the map is blank.** Blind spots are information.

The operator sees the same picture the agents decide from. So reviewing a decision means looking at the agent's actual inputs, not a god's-eye reconstruction.

### The swarm is a hive mind

The viewer is a **free camera over all clusters' combined sensor data**, not locked to any one cluster's perspective. Fusing the clusters' views is core to the concept, not a later phase.

- **Occupancy fusion is cheap:** per voxel, the most recent observation wins, carrying its timestamp.
- **Contact fusion is the hard problem:** two clusters seeing one contact from different angles have to be correlated into a single track.

### Observations age

Opacity scales against time to show how recent an observation is.

- **Decay rate depends on the observation class**, not one global clock. Structure decays slowly, moving contacts fast, and transient signatures (heat, emissions) fastest.
- **Important contacts keep an opacity floor**, so they dim without disappearing.
- **Staleness reaches the agents too**, so no one acts on a contact that left minutes ago.

### Encoding: one channel, one meaning

| Channel | Encodes |
|---|---|
| Opacity | Recency |
| Color | Affiliation or classification |
| Geometry | Entity type |
| Labels | Detail on demand (hover or selection) |

MIL-STD-2525 affiliation colors and frame shapes are the candidate vocabulary: operators read them without training.

Two supporting overlays:

- **Coverage:** each sensor's current footprint, showing where the swarm is looking now versus what it only remembers.
- **Provenance:** selecting any element shows which drones observe it now and which saw it last.

### Alert-only commands require a human, enforced by identity

Commands in the catalog are designated either **autonomous** or **alert-only**. An agent can *request* an alert-only command but can never approve one. The approval has to come from a human, under a separate identity.

- **Agents act as their own workload identity.** Each cluster's harness can publish observations, run its autonomous commands, and publish alert-only requests. It has no permission to publish approvals, and NATS enforces that at the subject level with per-identity JWT/nkey permissions. The harness is *unable* to approve, not merely instructed not to.
- **The human approver is a separate authenticated identity,** authorized for specific command classes and cluster scopes. Having a viewer session grants nothing.
- **An approval is a signed binding** of:
  - the approver's identity,
  - the request ID,
  - a hash of the exact command parameters,
  - a reference to the sensor snapshot the approver was shown,
  - and an expiry.
  
  It can't be replayed, applied to changed parameters, or used after it expires. This is the verifiable-credential shape from the DID/VC work, with a concrete consumer.
- **Verification happens at the edge.** The cluster's command API verifies the binding itself rather than trusting an upstream check.
- **Defaults:**
  - An unanswered request expires as denied.
  - A request whose picture has changed materially is re-presented, not approved against stale context.
- **Two-person rule** is a straightforward extension for the highest command class.

The approval queue lives in the viewer, with the requesting cluster's sensor picture attached. Request, approval and execution each carry an identity in the audit log.

## Proposed architecture

### Two kinds of traffic

| | Telemetry | Events and commands |
|---|---|---|
| Content | Positions, headings, raw sensor samples | Contact detected, behavior changed, command requested, approved, executed |
| Volume | High, at tick rate | Low |
| Loss | A dropped sample is acceptable | Nothing may be lost |
| Transport | Core NATS | JetStream (durable, audited, replayable) |

The outbox relay from the messaging spike fits domain events and is wrong for telemetry.

### Topology is perception

The subject hierarchy (`swarm.<cluster>.<drone>.…`) mirrors the command hierarchy, and **subscription permissions define what each principal can perceive**. That carries Sovereign Grid's "fog of war emerges from NATS topology" into the swarm.

- **Ground truth** exists in the simulation, to generate sensor readings, but no harness or viewer identity can subscribe to it.
- **An opt-in evaluation layer** overlays truth against perception. It's how you tell a bad decision apart from a good decision made on bad perception.

### World and sensors

- Terrain is a static chunked asset; voxels never travel on the stream.
- Sensors are real queries against the simulated world, such as line-of-sight raycasts through the voxel grid.

### Viewer

- The browser subscribes to NATS directly over WebSocket, with a read-only credential and no gateway.
- A JetStream KV bucket holds the last-known state per entity, so a late joiner starts from a snapshot and then applies deltas.
- Rendering: instanced meshes with per-instance alpha, plus `alphaHash` to avoid depth-sorting cost across thousands of translucent voxels; greedy-meshed terrain chunks; billboarded symbols.
- **Replay** is a timeline scrubber over the same stream, which is useful for evaluation and briefings alike.

### Simulation timing

**Lockstep first:** the sim advances a batch of ticks, publishes observations, the agents decide, and the next batch runs. Runs are deterministic and replayable from the event log, so a revised skill can be rerun against the same scenario and the outcomes compared. Real-time mode, where slow agents fall behind, is a later finding.

### Tool scope is capability

Each cluster's command set comes from its drones' actual features, so the harness tool allowlist *is* the capability model. That answers the harness spike's default-deny question by construction.

## Open questions

- **Shared or restricted agent perception.** Do cluster harnesses see the fused picture, or only their own sensors?
  - Shared perception makes coordination emergent.
  - Restricted perception forces explicit messaging between agents and models degraded links honestly.
  
  Topology makes either one a permission setting, so it could be a switch per scenario.
- **The contact-correlation approach** for fusing tracks across clusters.
- **The observation-class taxonomy** and the half-life for each class.
- **Harness throughput.** How many concurrent cluster sessions local inference (the Strix Halo box) sustains, which caps the swarm's size.
- **Native vs. browser viewer.** Browser via three.js is the assumed starting point.

## Phases

1. **World, stream and viewer.** Scripted clusters, no AI. Proves the sensor model, fusion, decay, and the viewer.
2. **One cluster under a harness,** in lockstep. Proves the skill, the behavior-command interface, and the alert-only flow with real identities.
3. **Several clusters with shared perception and coordination,** evaluated through replay. Proves concurrent sessions and swarm-level behavior.

## Dependencies

- **v1.messaging:** the event layer, JetStream conventions, and stream ownership.
- **v1.ai:** the harness driver. The concurrency and IL6 questions left open there get real answers here.
- **v1.auth:** the capstone is a proving ground for the auth strategy before go-auth lands.
- **DID/VC R&D:** signed approvals as verifiable credentials.
qq