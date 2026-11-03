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
// A run whose document's name matches one of [Config.Fail]'s rules, the
// emulator's test seam for a failed run, fails at the rule's stage instead:
// when that stage is due, Advance publishes the run's [RunFailed] event,
// then records the stage failed with its reason, and the run, its status
// [Failed], advances no further. The stages before it stay complete, the
// stages after it pending, and no stage event is published for the failed
// stage.
//
// A run whose document's name matches one of [Config.Hold]'s rules, the
// test seam for a run under way, holds at the rule's stage: the stages
// before it complete and publish as any run's do, and the held stage is
// never due, so Advance publishes and records nothing for it and the run
// stays [Running], that stage its first [Pending] one, for as long as the
// process runs. A name both kinds of rule match stops at the earlier of
// their stages, and fails when they name one stage.
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
//     [Complete], [Failed]) and [StageState] ([Pending], [Done],
//     [Faulted]).
//   - [StageCompleted], the stage event type's last segments, and
//     [StageCompletedData], the event's data; [RunFailed] and
//     [RunFailedData], the failure event's.
//   - [ErrNotFound]: an unknown run id, a 404.
package run
