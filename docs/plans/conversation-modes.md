# Conversation mode presets

The chat settings sheet offers Fast (Codex Luna / none), Balanced (Codex Sol 6.1 / medium) and Deep (Codex Astra / high) when the gateway's configured mobile catalog reports the exact provider and model as available. Unavailable choices remain disabled. These are explicit session mutations; they do not purchase service tiers or modify profiles, configuration, voice settings, memory or tools.

The header and settings label the current mode from the shared session's reported model, provider and requested and effective reasoning. Missing, custom, or clamped values appear as Custom. Mutations carry model, provider and reasoning together and are serialized with locally initiated durable sends; confirmation and deferred results use the existing Hermes session controls. Desktop can also change this shared policy. Existing model, reasoning and favourite controls remain available.

A locally saved message can still be waiting for a gateway admission after its send operation returns. A preset change is refused while that session has any outbox entry, including uncertain or failed delivery, and the user is prompted to resolve it first. This prevents the local preset request from overtaking that pending message; it does not claim to order independently submitted Desktop work. Changing a preset does not clear the draft or retry the message.

Model availability, actual provider effort, conversational quality, native phone behavior and performance improvements are not established by host tests. Owner device acceptance and approved, allowance-bounded measurements remain required.
