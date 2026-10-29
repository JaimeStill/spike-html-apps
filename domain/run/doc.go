// Package run is the run domain layer: the emulated pipeline run each
// accepted document starts, its stages advancing one per interval and each
// completed stage published as a CloudEvent, served under /api/runs.
//
// A run passes through [Stages] in order: upload, metadata, extraction,
// chunks, and embeddings. Its first stage is due when the run starts, and
// each later stage one stage interval after the one before it was due, so
// the schedule is anchored at the run's start and a late pass never delays
// the stages after it.
// [Service.Advance] completes every stage that is due, one per run per
// pass, and publishes its [StageCompleted] event before it records the
// stage complete, so a stage a read reports complete has its event on the
// broker. A publish that fails leaves the stage pending, and the next pass
// publishes it again under the same id, which a broker's deduplication
// drops if the first publish did land. Advance is the handler of one
// reactor, over the source [Service.Ticks] returns: an interval a fifth of
// the stage interval, so a stage completes at most that long after it is
// due, which [Service.Start] nudges when a run starts, so its first stage
// completes at once.
//
// All state is in memory, guarded by one mutex; nothing outlives the
// process.
//
// The package's API:
//
//   - [Service], built by [New] from a [Config] and a messaging.Publisher:
//     Start, Run, and List, the layer's operations; Ticks and Advance, the
//     reactor's source and handler.
//   - [Routes]: the route group the composition root mounts.
//   - [Run] and [Stage], the read shapes, with [Status] ([Running],
//     [Complete]) and [StageState] ([Pending], [Done]).
//   - [StageCompleted], the event type's last segments, and
//     [StageCompletedData], the event's data.
//   - [ErrNotFound]: an unknown run id, a 404.
package run
