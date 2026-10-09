Human-only document: do not edit without permission.

# Overview

I want to create my own personal agent. Let’s call him Ash. I want Ash to be at the center of my life; part friend, part helper, part second brain. I want Ash to feel a few ways:

1. Ash is *not* me, and doesn’t pretend to be except in specific circumstances (Ash can’t publish writing or send messages as me)
2. Ash is capable, concise, and always seeking to be maximally helpful and honest
3. Ash lives across my computer, my phone, and any wearables with mic or speaker
4. Ash may control my apps, computer, or phone (if possible) to accomplish tasks
5. Ash can and does work in the background
6. Ash can handle any (reasonable) modality for input or output
7. Ash has deep context on my life; all of my data (via connectors), and all of my digital actions (via observability)
8. Ash can modify himself
9. Ash can build custom applications on top (proactively or upon request) to improve my life or workflows
10. Ash is private; others cannot interact with Ash
11. Ash is architecturally simple and carefully crafted

# 🧑‍🤝‍🧑 Interaction Model

Before we discuss capabilities, features, and structure, let’s talk about the interaction model between the user and Ash.

## Topics, Threads, and Artifacts

One of the core parts of Ash is his Artifact Engine. In most agents, we have a choice between two chat UX structures:

1. Projects + chats
    1. Everything lives in a chat
    2. Projects are used to organize in the UI + derive context
    3. Often, both of these primitives must be managed manually)
2. Single-threaded
    1. Everything lives in a single chat, commonly an iMessage thread

Neither of these feel right. The latter is too restrictive, and the former is both frustrating to manually manage and also potentially overloads projects with the jobs of UI organization AND context engineering.

### Primitives: Topics, Threads, and Artifacts

I believe a better system has 3 primitives:

- Topics: organizational categories, similar to projects, that are intelligently managed
    - Topics are meant to be semantic, and may be created by the user or suggested by Ash
    - Topics form the basis for the context engine (threads are injected with context from all relevant topics) as well as visually organize conversations and events for users
    - Example: “Home” vs. “Finances” vs. “School”
- Threads: sequences of artifacts (such as messages or one-off items, like an email)
    - Threads are also semantic, and entries in the thread may be moved in/out of threads
    - Example: “November Rent” vs. “December Rent” vs. “Repair Checklist”
- Artifacts: singular entries that represent “data related to this matter” - a user message, an Ash message, an email, a task, a TODO reference, etc.

Artifacts are the core building blocks: it’s a “thing” with a time, and maybe references to other Artifacts. These could be created from messages (by the user or Ash), emails, notifications, an action that Ash performed, a permission check, etc. - and each Artifact may have its own special UI or just be recorded as text. Artifacts are created from inputs, then processed by Ash until a final output is ready to show to the user - this is a Surface Artifact.

For example, if your landlord emails you about October rent, Ash may create a Thread called “October Rent” with that email as the initial Artifact. Then, you might ask a question, which is another Artifact, and Ash will respond - another Artifact. Then you might say “Draft a response” (another) and Asha calls a tool to do this. Messages and “events” coexist and are processed in the same way; ultimately, the engine only cares about *where the data should go* (routing) and *how to respond* (acting).

Topics can be thought of as “categories” where Threads within them will often reuse the same context. Threads are a specific, continuing matter. These could be long-lived, like a Thread where Ash tells you about every friend’s birthday, or it could be a quick conversation about what to have for dinner. The key to this system is the auto-managing: if you reorganize the Topics, or accidentally ask about dinner in your finance-cleanup Thread, pieces can be moved between seamlessly. And with good organization, Ash can also find information better and thus be more helpful and honest.

To make the system user-friendly, I believe this auto-management should be user-guided and user-overridable. Users may provide instructions for Topics and Threads to provide hints for Ash. For example, “The Finance Topic is for anything related to my finances, but NOT shopping - anything shopping-related goes in the Shopping topic”. And auto-management is always suggested by default, never applied automatically.

Ideally, this system should allow the user to create relevant Topics for their life, then automatically keep all threads in semantically-relevant Topics for ease of access and efficient context engineering.

### Managing Threads within Topics

Threads may be linked to zero or more Topics. Topics are used, to start, for both context engineering (ie. context from the Topic is injected into any agent turns) and for organizational UI, though these may be separated later.

Some behavior guidelines:

1. Threads may live in zero or more Topics (ideally as few as possible)
2. Threads that are started without an explicit Topic should be added to any relevant Topics
3. Threads can be added/removed from Topics by the user, or suggested by Ash
4. Topics may be created or deleted by the user or suggested by Ash
5. When a new Topic is created, existing Threads are added to it as relevant (this can be done async)
6. If a Thread’s semantic purpose drifts away from its Topic, Ash should suggest to remove it
7. If a Thread’s semantic purpose drifts towards a different Topic, Ash should suggest to add it

### Artifacts within Threads:

Artifacts belong to a single Thread, though they may be moved freely between Threads.

Some behavior guidelines:

1. Artifacts can only belong in one Thread, but they may be referenced by a Reference Artifact for visibility within other Threads
2. Splitting: if a Thread’s semantic purpose becomes split, Ash may suggest to move a group of Artifacts to a new (or existing) thread
3. Merging: if two Threads have similar purposes, Ash may suggest to move Artifacts between them or combine them entirely

### Artifact Engine

Ash needs to handle “Artifacts”, but where do these come from? Artifacts are produced from structured and unstructured data which may be discrete or continuous. For example, a new email is discrete and (mostly) structured. However, a security cam video stream is continuous and unstructured; we may want to “watch” this video for specific events. The system should be able to take both of these inputs and create Artifacts to feed into the interaction model.

Further, all of this data needs to be processed in parallel and with high throughput. It also needs to be easily auditable and retraceable; perhaps even replayable. I propose that the system uses a master “Artifact Log” which processes “Artifacts” (which are “events” in SWE terminology).

To build a system that allows Ash to process all of this data effectively, I propose a multi-layer system. At each layer, an Artifact is created and appended to the log.

1. Listen
    1. This is where continuous input is “watched” - voice, video, other streams
    2. No artifacts are created in this layer; only processing (question: should there be any?)
2. Input
    1. Artifacts from Listen layer and discrete input is ingested here
    2. This is “border control” for Artifacts - where all inputs are logged for auditing
    3. In the settings, “Listeners” can be configured to allow Ash to listen for data from any source; connect your email, a wearable, a video stream, webhooks, etc.
    4. “Artifact” here means: “This is an input that may be relevant for Ash”
3. Filter
    1. Filters Artifacts for relevance, dropping anything irrelevant/spam/noise
    2. Artifacts are created whether the filter propagates or drops the event
    3. “Artifact” here means: “This is an input that is relevant for Ash”
4. Route
    1. Routes the Artifact to the correct Topic and Thread
    2. Artifacts are created whether it is routed to a Topic/Thread or not
    3. “Artifact” here means: “This is a relevant input, and Ash knows where it belongs”
5. Act
    1. Ash takes action (chat response, tool call, etc.) inside of a worker, with this workflow being recorded in a Runs table (with durable continuation, waits, cancellation, retries, etc.)
    2. A Run tracks (at minimum) its inputs, purpose, status, continuation/wait information, related entities, and results
    3. Artifacts are created for all actions Ash takes (including thinking)
    4. “Artifact” here means: “Ash did something”
6. Surface
    1. Ash decides which Act layer artifacts should be shown to the user, and adapts their presentation to deliver them to the appropriate interfaces (eg. which devices, notification or not, etc.)
    2. Artifacts are created for all entries inside of a Thread that should be user-visible
    3. “Artifact” here means “Ash said/showed something to the user”

There may be more layers in the future (eg. a security layer, a prioritization layer, etc.), but I believe these are the basics. As an Artifact passes through the layers, it will create an “Artifact Chain” - all Artifacts start from an Input Artifact, and propagate upwards until Ash can respond in the Act layer. Any chat, event, or other action Ash takes can be traced back to an Input Artifact. 

Within a Thread in the UI, the user may visually see a sequence of Artifacts, but the sequence does not represent an Artifact Chain; some items in the thread may be part of the same artifact chain (for example, if 2 TODOs were created from the same email), but they also may not; it depends on if they were created by the same Input Artifact. Think of them as a forest of leafy trees: all the leaves in the canopy are visible Artifacts that a user will find in Threads. But all the branches and tree trunks are Artifact Chains. The leaves can’t exist without the tree trunks, and the user can only see the leaves.

A few notes:

- Listen layer does not create artifacts; it’s essentially a “sensory input” layer
- Input layer will receive tons of artifacts, but only a portion of these will pass the Filter layer
- Route layer will use intelligent defaults and user-defined instructions to effectively route
- Act layer includes the initial action Ash takes to process the input, as well as any intermediate actions (ie. tool calls during thinking), as well as any actions created immediately-following actions
- Ash may add inputs to the input layer
- Artifacts may include hints or explicit directions to shortcut engine decisions
    - For example, an input artifact may have an explicit Topic/Thread tagged; this allows us to ensure user messages sent in a thread stay in that Thread
- Not every layer must be traversed for every Artifact Chain; layers can be skipped in specific cases, such as for User Inputs,
- User Inputs create an Artifact on the Input layer, and the two branches may come from it:
    - One Artifact is created on the Surface layer to represent that Input’s visibility in the UI
    - The Artifact Chain created for the response (if a response is needed)

## Replayable State

The Artifact Log should contain all information necessary for the full reconstruction of the current state from a database clean-slate. This can be accomplished by keeping all inputs and outputs fully encapsulated within Artifacts. This includes Artifacts’ data, but also membership of Artifacts within Threads and Threads within Topics.

The log is authoritative for the defined core state; database tables are projections. Corrections and organizational changes append records rather than rewriting historical Artifacts. Reconstruction applies recorded events without rerunning models, tools, or external effects.

One note is that Ash’s self-modding capabilities may make this difficult. We can account for this either in a separate log for schema changes, or perhaps by snapshotting the entire database every time a breaking schema change is made.

## Context Engine

The interaction model is relevant to the context engine, which informs Ash’s responses. When an Artifact is created on the Route layer, Ash must then take this and gather all relevant context to take action most maximally and honestly. This includes:

1. System instructions
    1. Personality
    2. Operating manual
2. The Thread
    1. Include all Artifacts from the current Thread (perhaps up to a limit)
3. The Topic(s)
    1. Include summaries and/or specific context from other Threads in the Topic(s)
4. Relevant memories
5. Relevant tools
6. Relevant events from the observability log
7. Entities from features such as open TODOs, decisions, etc.

Some of this may be injected directly into the prompt, and the rest of it can be progressively disclosed through tool calls. The context engine must be fast, but not compromise on quality. To do this, we need to devise a way for Threads and Topics to be easily searchable for the context engine; this may be as simple as keyword search, or as complex as embedding the contents of all Topics/Threads or even the Artifacts within them.

## Memory Engine

Memory is critical to context, and there are many situations where good memory can be helpful for the agent. Breaking memory into roughly 4 categories and assessing each:

- **Working memory:** acts as temporary RAM or a scratchpad using the current context window for active tasks
    - The context engine already handles this
- **Semantic memory:** stores lasting facts, rules, and user preferences
    - This is where no other system works so far
- **Episodic memory:** records logs of past events, experiences, and previous chat sessions
    - The context engine already handles this, and the agent also has tools to search more deeply
- **Procedural memory:** holds behavioral guidelines, habits, and workflows on how an agent should act
    - Instructions already handle this

It seems like mainly we want to build a system for strong semantic memory, but there are a few questions:

- What info would we even care to store? Are facts that helpful? Should we instead store these in Instructions?
- How do we deal with stale memories and forgetting?
- Do we roll our own or use a third-party service? How does privacy work with those?

## Visibility

I want an intelligent visibility layer that manages which Threads are visible in the UIs. There are many chats or events which aren’t relevant after a finite amount of time: quick notes, one-off questions, chats about events that happen at a specific time, etc.

All Threads should have an associated datetime at which they are archived; archiving makes them invisible (though they can be found in an archive view), but still allows them to be used for context engineering. Archived Threads can be revived as well upon new activity.

Visibility thresholds are recalculated when the Thread is created as well as every so often after the Thread has been modified (ie. new messages in chat, activity on event’s action chain). Recalculating the threshold should be intelligent; it should use all relevant context to determine whether it should live for only a few minutes, indefinitely, or not at all. During recalculation of the visibility threshold, we may also want to recalculate the Thread name.

As a related note, we will want to indicate which Threads have work currently in-progress as well as Threads with new activity for the user to view. We should also consider manual overrides, pinning, and undo functionality for users. Finally, whenever visibility is recalculated, These systems will need to work together to achieve a clean UX.

## Live Mode

There should be a “Live Mode” that allows the user to enter a realtime, continuous voice (and, optionally, video) session with Ash. While in Live Mode, the user can speak to Ash as a normal voice AI, and Ash can take action within any Thread.

In Live Mode, Ash may maintain a “focus” on one Thread at a time (or none); this Thread’s context is supplied most heavily to Live Ash, and, barring any context changes or explicit instructions, Ash will by default assume you’re speaking about the focused Thread and take relevant actions there. During Live Mode, the user can still interact with the entire app as normal; Live Mode simply allows the user to interact with Ash synchronously, and for Ash to interact with the app “above” Threads.

Live Mode’s transcript and any relevant actions use the Artifact Engine; user utterances create Input Artifacts, Ash’s responses/actions create Act Artifacts, and visible/spoken content creates Surface Artifacts as the interaction happens.

Each Live Mode conversation is recorded in a Live Thread, which is a special type of Thread. Its conversation Artifacts are assigned directly to that Thread. Ash may still retrieve context from and perform work in other Threads, publishing results or references there when useful.Live Threads also won’t appear as normal Threads; there will be a separate UI for Live Mode.

Live Threads record a live interaction and cannot be typed into directly. Pausing or switching devices preserves the Thread; ending Live Mode closes it, though it may be resumed later. Live Threads don’t become normal Threads afterward, but references can connect their conversations to relevant work in normal Threads.

## Open Questions / Notes

**What is the right amount of automation?**

In the spec I lay out topic-management behavior very conservatively; Ash must suggest for most actions. But does that hinder Ash’s capacity to be useful? Perhaps requiring suggestion is the right start at the beginning, and I can evaluate the quality before allowing more automation.

**Are these the right engine layers?**

Perhaps there are more layers, or perhaps some of these need to be combined or separated. Two on my mind:

1. Should we separate the routing layer for Topics and Threads?
2. Are we sure the Listen layer doesn’t create artifacts?

**How to debug? UI? Dashboard?**

In my previous experiments, I made a dashboard that showed the full event stream and I could click into details for each event, thread, etc.

It probably makes sense to turn the master event log into a dashboard like that, but also provide debug/inspection tooling directly into the UI in dev mode.

# 🤖 Agent

## Basics

Ash will have all of the hallmarks of a typical agent:

- System prompts (including personality)
- Model router (ideally automatic)
- Skills (core part of reproducible/consistent workflows and self-modding capabilities)
- Context engine
- Memory engine

Ash can take action and retrieve data with:

- Tools
- Connectors (APIs)
- MCP
- Filesystem access
- Observability

Ash supports several modalities:

- Discrete
    - Text
    - Dictation
    - Images (attachment)
    - Video (attachment)
    - File (attachment)
    - External events (eg. notifications)
- Continuous
    - Video stream
    - Data stream
    - Live voice

## Built-In Features

Several features will be integrated deeply into Ash’s various systems, such as the permissions or background worker systems. These could be built on top of extendable primitives, and will receive special treatment in their logic or UI.

### Tasks

- A TODO list which is shared between user and Ash
- Items can be added and completed by either user or Ash
- An “owner” can be assigned for each item; no owner means either user or Ash can work on it
- Ash will pick up and work on items assigned to him when time allows
- Items can be snoozed, completed, archived (no longer relevant), or deleted
- Tasks exist outside of threads, but may be linked to threads for easy access

### Decisions

- A list of items which require user input
- Ash may create items to double check with the user; this could be new tools, permissions, ideas, expenditures, data integrity, organization, etc.
- Any time Ash needs user input, it will appear on here
- Time-sensitive decisions may also trigger a notification
- Items can be snoozed, approved, declined, or potentially other actions in the future; approving or declining may allow additional comments that Ash can use to follow-up
    - Or maybe the actions (outside of snooze) are custom, Ash-decided actions depending on the item?
- Decisions exist outside of threads, but may be linked to threads for easy access

### Notifications

- A notification log that Ash may create items on
- Notifications may include time-sensitive reminders, decisions, or info
- Only Ash can create notifications; external apps must create an input, which then propagates through the artifact engine and acted on by Ash; Ash will then decide what to show in the notification
- User may snooze, dismiss, or comment on a notification (Ash can use comments to follow-up)

### Permissions system

- Ability to set fine-grained controls for various types of access
- Possible settings are always, ask, never
- Includes access for filesystem, external tool calls, sensitive actions, etc.
- Integrates with Decisions system

### Apps

- Apps that can be created/modified by the user or Ash
- Includes:
    - Canvas (document)
    - Drawing
    - File viewer
- Created Apps will have versioning, and may be searched or cited by Ash
- Apps exist outside of Threads, but they can be linked within Threads for easy access

### Computer / Browser Use

Among actions such as tool calls, MCP calls, API requests, etc., I also want Ash to be able to efficiently control my computer as well as browser.

We can use any technology to do this, but we need to figure out a good architecture. Ideally:

- Ash can pilot my own computer/browser if I am asking for help (with permission)
- Ash can pilot a separate (virtual?) computer/browser
    - If the task is generic, any computer/browser will work
    - If the task requires my applications/data/files, ideally there is a way for him to retrieve this without taking over my computer
- Computer/browser use works even when I’m away and/or my computer is off

There’s currently a gap on the second point; if I want Ash to accomplish something which requires some state or application that exists on my computer, but I don’t want him to take over my computer (or it’s off), how might he do this? I’ve considered perhaps I sync some application state to a remote service which Ash can access and copy as-needed into VMs, but we should explore this and other options more.

## Data Primitives

To support the features we want, we’ll need some database tables:

- Artifact log (all artifacts)
- Topics
- Threads
- Runs
- Notifications
- Approvals
- Tasks
- Permissions
- Memories
- Apps
    - Canvas
    - Drawing
    - File viewer
- Databases (separate from Asha DB? different DB for each app?)
- Observability log (screenpipe)

We’ll also need a persistent file storage for storing attachments, app data, etc.

## Instructions

There are several places where Ash’s behavior follows specific instructions and guidelines, codified as prompts. It’s important that the user can easily view and modify Ash’s instructions. Ash should also be able to modify these instructions with an explicit Decision. Decisions will guide behavior in all systems:

- Artifact engine (each layer’s behavior)
- Context engine (how to assemble context)
- Memory engine (how to search memories, notes, common patterns/mistakes)
- Tools (which ones to use when, notes, common patterns/mistakes)
- Features
- Devices
- Custom apps
- etc.

Basically, whenever a prompt is used to guide behavior, it must be accessible and modifiable by the user. Some of these systems may even require more than just a single instruction; for example, the context engine is a massive system with progressive disclosure built in (eg. we can’t just load every memory into the context every time). We’ll need to find a way to allow the user to modify each system appropriately.

# 🖥️ Interfaces

Ash should feel present on all devices, and intelligently exist across them. The core experience will be on the desktop and mobile apps, though Ash should support other devices and interfaces as well, such as wearables. Artifacts can be tagged with device data, which can be used as context for the artifact engine layers and other instructions.

Ash should adapt his behavior and responses to the device. For example, if I’m on mobile in voice mode, I probably don’t want to look at my phone right now, so instead of asking a question a TODO might be created instead. If I dictate via a smart ring, I probably don’t want a chat response unless I’m also wearing headphones. These rules should be codified as Instructions in the proper places.

## Desktop App

The desktop app will be the heavy-duty workhorse geared towards parallel work, voice-first but still text-savvy, inspectable, and always-on by default.

- Sidebar topic/thread list
- Chat viewer
- Feature panels
    - Tasks
    - Decisions
    - Notifications
- App panels
    - Canvas (markdown editor)
    - Drawing (mermaid/UI editor)
    - File viewer
- Desktop companion
    - Voice controls/indicators (default always visible, toggleable to be hotkey-visible)
- Shortcuts
- Context inspector
    - View the current full context state of a thread
- Artifact engine inspector
    - Log with filter by data type, system, etc.
    - Realtime data stream visualization

## Mobile App

The mobile app is focused on viewing topics and threads, keeping up to date on what Ash is doing, and checking on Tasks, Decisions, and Notifications.

- Topic/thread viewer
- Chat viewer
- Feature panels
    - Tasks
    - Decisions
    - Notifications
- App panels
    - Canvas (markdown editor)
    - Drawing (mermaid/UI editor)
    - File viewer
- Quick access from lock or home screen (shortcut? lock screen widget?)

## Wearables

Connecting new devices should be seamless, and Ash should adapt to them automatically. Two I plan to use:

- Smart ring
    - Microphone-only: short bursts/thoughts to send to Asha
- Bone conduction headphones
    - Listening to important Notifications on the go, or maybe used in conjunction with smart ring to have whisper-conversations without bothering others or preventing me from being in a conversation

# 🌀 Self-Modding

One of Ash’s best qualities is his ability to modify himself. This includes everything from the artifact engine, to the instruction prompts, to the features, to the custom apps that Ash creates on top. There are roughly three layers that could be modified:

1. Instructions
    1. Most common, medium risk
2. Custom apps
    1. Create and modify custom software applications on top of Ash
    2. Decently common, and low risk (if we sandbox effectively)
3. Ash’s code
    1. Modify any part of Ash’s systems
    2. Less common, high risk (depending on the system)

## Custom Apps

It’s important that Ash is able to build custom apps on top of himself. These could be small apps that serve a single purpose, such as a flashcards app, or it could be a complex app such as a finance tracker or CRM.

Building these apps on top of Ash provides a few benefits:

- They’re AI-native by default, and be used through Ash on any of my devices
- They can be modified with the same self-mod workflow that Ash uses
- They are custom-fit to the user, containing all of the features I want and none of the features I don’t
- They can be integrated with Ash’s systems, such as Permissions or Decisions
- Ash can proactively improve them based on my usage/workflow

These custom apps will need infrastructure to run. We can architect them to start as just web apps. They’ll need, at a minimum:

- Isolated database
- Isolated file storage
- Backend worker + frontend worker (do we need both?)
- Potentially other services (eg. cache, VM, etc.)

The primary mode of use of these apps is hybrid; the user and Ash can both work in them at the same time, or just one or the other. The user can use them on either desktop (either embedded, or popped-out from Ash), or in mobile (as a webview inside Ash).

The data from these apps should be kept separate from Ash in isolated stores, and their VCS should also be separate. Custom apps are personalized to a user, and should never be included in the primary Ash version control.

## Modifying Ash’s code

Ideally, to start we would have a simple workflow that Ash can modify himself with:

1. When prompted to change, Ash spins up a workspace (on top of a git worktree, like Conductor) to isolate changes; this workspace has all the tools Ash needs to modify his own code, test, and push changes
2. We use the detached Codex harness to do the heavy lifting
3. Self-mod workspaces are integrated with the Decisions, Notifications, and other relevant systems to provide the workflow

We’d also aim for good testing infra and snapshotting/reversion mechanics.

## Version Control + Sharing

The larger vision for self-modding is that Ash *adapts* to the user by modifying himself and building custom apps on top. I’m not aware of robust systems or methods for handling version control with adaptive software. There are tricky questions that arise:

- How does code get merged when the code is likely changed?
- What does version control look like?
- If I open-source Ash, how might we deal with the base Ash getting out of sync with the modified instances of Ash?

I’ve considered a system where, instead of merging code, we focus on *concepts*. Perhaps there is Ash’s base code, and as you modify it this is recorded in a log (or something akin to a “tech tree”) that tracks dependencies. When the base upgrades, the tree can be analyzed for conflicts and Ash can work through combining the changes.

This may also provide another benefit: the user could share a branch of the tech tree to other users of Ash, which would allow Ash to build “from the base”.

Let’s brainstorm version control approaches before we implement so that we don’t architect ourselves into a dead end, but it’s most important to focus on the core functionality first.

# 💡 Other Features

- Timeline
    - Ash creates a detailed timeline of what the user does every day based on observability, calendar, and other relevant data sources
    - Searchable, especially useful for dreamtime
- Dreamtime: when models have extra usage, review data, conversations, timeline, etc. to suggest (or autonomously make) improvements
    - Can mark agent-assigned tasks for doing during dreamtime?
    - Can also do whatever it wants in its own private file-vault?
- Location access
- Voice diarization + filtering to only listen to me?
- Store full context stack for each artifact on the Act layer? Would that be too much data? Would be super helpful for debugging

# 🛠️ Use-Cases

- Notes
    - Either integrate with Obsidian or custom app
- Can handle recurring workflows/tasks
- Can handle long-running tasks that need to be broken down into large trees
- Daily/weekly/monthly summary of important info (modifiable)
    - News, personal progress, important upcoming things, etc.
- CRM
    - Manage people, autonomously create/modify/remove
    - Suggest catch-ups or events
    - Very good search (for agent and me)
    - When I meet or mention people, adds to CRM
    - Dreamtime can look into CRM for people to research based on upcoming calendar, not filled out, or convo history?
- Finances
    - Track my own finances like Monarch
    - Very good search (for agent and me)
    - Track my own assets, eg. stocks + crypto across all platforms
- Use-case planner
    - New use-cases can be written down, calls a refined skill, and agent suggests what core system changes need to happen to enable it
- Bar app
    - Mixel, but better
- People researcher
    - Find someone’s entire digital footprint
    - Search into past jobs, friends/family, etc.
    - FBI level psychological profile
- Apartment watcher
    - Put in searches for apartments, it alerts when new ones come on market
- Show and tell
    - Record screen, perform workflow/task, and agent creates a workflow out of it
- Social media manager
    - Watch social media for top news to know
    - Manage reply-guying and post ideas
    - Never write for me
    - Reaction image search
- Spreadsheet app? (or hybrid doc + spreadsheet?)
- Customizable homepage?
- Meeting notes that feed directly in (replace Granola?)
- Should ask questions to learn more about me/my life
    - Eg. if I mention I don’t like a food, place, etc. - why?
- Personality glyph that changes based on attributes
    - Eg. mine might have 2 fuzzy, wavy rings revolving around a few shapes to describe its specific personality
    - The glyph over time as it changes personality/capability/etc. (as it adapts to you)
- Gamify using talents/achievements to show how it becomes more personalized over time
    - “Talent trees” to describe personalization/extension trees, and which summarize the feature to allow you to share a prompt to others to replicate?
- Flashcards
    - People/companies to know in SF
    - History/theology
- Better autofill
    - Context-aware autofill across computer
- Crypto bot
    - Test and experiment with algorithms to deploy
    - Backtesting suite included