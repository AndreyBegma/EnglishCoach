## Access
access-denied = Sorry, this bot is private. Ask its owner to add you.

## Admin commands
admin-allow-usage = Usage: /allow <Telegram ID>
admin-deny-usage = Usage: /deny <Telegram ID>
admin-allowed = User { $id } is allowed.
admin-denied = User { $id } is no longer allowed.
admin-unknown-user = User { $id } is not known.
admin-users-empty = No allowed users yet.
admin-users-title = Allowed users:

## Hub
hub-title = EnglishCoach — what shall we do?
hub-last-session = Last session: { $summary }
hub-learn = 📚 Learn words
hub-review = 🔁 Review ({ $count })
hub-grammar = ✍️ Grammar
hub-talk = 💬 Talk
hub-progress = 📈 Progress
hub-profile = 👤 Profile
hub-settings = ⚙️ Settings
hub-back = ← Back
hub-coming-soon = Coming soon.
hub-outdated = This menu is outdated.
hub-locked = 🧭 Lessons open after the placement test: about 20 minutes, taken in one go.
hub-locked-toast = Take the placement test first.
hub-placement = 🧭 Placement test

## Settings
settings-title = ⚙️ Settings
settings-ui-lang = Interface language: { $lang }
settings-explain-lang = Explanations in: { $lang }
settings-level = Level: { $level }
settings-level-unset = not set
settings-words = Words per day: { $count }
settings-timezone = Time zone: { $timezone }
settings-times = Morning { $morning } · Evening { $evening }
settings-reminders = Reminders: { $state }
settings-voice = Voice: { $state }
settings-english-variant = Pronunciation: { $variant }
settings-provider = AI provider: { $provider }
settings-on = on
settings-off = off
settings-btn-ui-lang = 🌐 Interface language
settings-btn-explain-lang = 💬 Explanations
settings-btn-level = 🎓 Level
settings-btn-words = 📚 Words per day
settings-btn-timezone = 🕒 Time zone
settings-btn-morning = 🌅 Morning time
settings-btn-evening = 🌙 Evening time
settings-btn-reminders = 🔔 Reminders: { $state }
settings-btn-voice = 🔊 Voice: { $state }
settings-btn-english-variant = 🗣 Pronunciation: { $variant }
english-variant-us = 🇺🇸 American
english-variant-uk = 🇬🇧 British
settings-btn-provider = 🤖 AI provider
settings-btn-placement = Retake placement test
settings-btn-timezone-other = ✏️ Type a name or send your location
settings-choose-ui-lang = Choose the interface language.
settings-choose-explain-lang = Choose the language for explanations and translations.
settings-choose-level = Your level: { $level }. Choose it yourself or take the placement test.
settings-choose-words = How many new words per day?
settings-choose-timezone = Your time zone: { $timezone }
settings-choose-morning = Morning session at { $time }. Choose a time:
settings-choose-evening = Evening session at { $time }. Choose a time:
settings-timezone-set = Time zone set to { $timezone }.
lang-en = English
lang-ru = Русский
lang-uk = Українська

## Settings: AI provider
provider-title = 🤖 AI provider
provider-server = Server
provider-claude-code = Claude Code (server)
provider-anthropic = Anthropic key
provider-openai = OpenAI key
provider-openrouter = OpenRouter key
provider-custom = OpenAI-compatible…
provider-custom-key = OpenAI-compatible API key
provider-custom-host = OpenAI-compatible ({ $host })
provider-runner = Own machine — coming in v2
provider-model = Model: { $model }
provider-model-default = default
provider-key-hint = Key: { $hint }
provider-btn-test = 🧪 Test provider
provider-btn-model = Model
provider-btn-reuse = Use the saved key
provider-btn-new-key = Enter a new key
provider-setup-saved = { $provider }: a key is saved ({ $hint }).
provider-switched = ✅ Provider switched.
provider-key-saved = ✅ Key checked and saved.
provider-key-rejected = ❌ The provider rejected this key. Nothing was saved. Paste another key or cancel.
provider-model-set = ✅ Model saved.
provider-testing = Testing…
provider-test-ok = ✅ Provider works ({ $ms } ms).
provider-current = Provider: { $provider }
provider-workspace = Workspace: { $workspace }
provider-btn-workspace = 🏢 Workspace ID
provider-btn-workspace-clear = Clear workspace
provider-workspace-set = ✅ Workspace ID saved. Test the provider again.
provider-workspace-cleared = ✅ Workspace ID cleared.

## Provider errors (Settings test; reusable in session prompts)
provider-error-detail = Provider says: { $detail }
provider-error-auth = ❌ The provider rejected the API key (HTTP 401). Check it or enter a new one.
provider-error-permission = ❌ The key has no access to this (HTTP 403). Check its permissions in the provider console.
provider-error-workspace = ❌ This key is not bound to a workspace (HTTP 400). Send the workspace ID from the Anthropic Console.
provider-error-model = ❌ The provider does not know this model (HTTP { $status }). Pick another model.
provider-error-rate-limit = ⏳ Rate limit reached (HTTP 429). Wait a minute and try again.
provider-error-credits = ❌ The provider account is out of credits or has no billing set up.
provider-error-overloaded = ⏳ The provider is overloaded or down (HTTP { $status }). Try again later.
provider-error-bad-request = ❌ The provider refused the request (HTTP { $status }).
provider-error-bad-output = ⚠️ The provider answered, but not with valid JSON.
provider-error-network = ❌ The provider could not be reached.
provider-error-unknown = ❌ The provider returned an error (HTTP { $status }).
model-title = Model: { $model }
model-list-empty = This provider did not list any models. Type a model ID instead.
model-page = Page { $page } of { $pages }
model-btn-default = Default
model-btn-type = ✏️ Type a model ID
input-key = Paste your { $provider } as a message. I delete the message right away, store the key encrypted and only ever show its last four characters.
input-base-url = Send the base URL of your OpenAI-compatible API, e.g. https://api.example.com/v1
input-model = Send the model ID (current: { $model }).
input-timezone = Send your location (📎 → Location) or type a time zone name, e.g. Europe/Kyiv.
input-cancel = Cancel
input-key-invalid = That does not look like an API key. Paste the key on its own.
input-base-url-invalid = The URL must start with https:// and must not point at a local or private address.
input-model-invalid = That does not look like a model ID.
input-workspace = Send the Anthropic workspace ID (Console → Settings → Workspaces), e.g. wrkspc_01Ab… Current: { $workspace }.
input-workspace-invalid = That does not look like a workspace ID. It starts with wrkspc_.
input-timezone-invalid = Unknown time zone. Type a name like Europe/Kyiv or send your location.

## Progress
progress-title = 📈 Progress

## Sessions
session-conflict = You have an unfinished session. Cancel it to start something new?
session-cancel-current = Cancel current session
session-keep-current = Keep going
session-cancelled = Session cancelled.
session-expired = Session closed after inactivity.

## Demo session
demo-start = Demo session: send me 3 messages and I will echo them back.
demo-echo = Echo { $n }/3: { $text }
demo-summary = Demo finished: 3 messages echoed.

## LLM providers
provider-unavailable-runner = Running on your own machine is coming in v2. Choose another provider in Settings.
provider-unavailable-server = The server LLM is not configured. Add your own API key in Settings.

# --- vocabulary ---
vocab-collocations = Collocations: { $list }
vocab-word-family = Word family: { $list }
vocab-mnemonic = 💡 { $text }
vocab-photo-credit = 📷 { $author } / { $source }
vocab-example-credit = 💬 Example: { $source } (CC BY 2.0 FR)
vocab-image-next = 🔄 Another picture
vocab-image-none = No other picture for this word.
vocab-got-it = ✅ Got it
vocab-know = 💯 I know this word
vocab-known = 💯 “{ $word }” is marked as known — you won't see it again.
vocab-known-undo = ↩️ Back to learning
vocab-known-undone = ↩️ “{ $word }” is back in learning.
vocab-add-word = ➕ My word
vocab-add-word-prompt = Send a word or phrase you want to learn.
vocab-add-word-cancel = Cancel
vocab-add-word-invalid = Send one word or a short phrase: letters, spaces, apostrophes and hyphens, up to 60 characters.
vocab-add-word-exists = You already have a card for “{ $word }”.
vocab-finish = Finish
vocab-retry = 🔄 Retry
vocab-start = ▶ Start
vocab-outdated = This question is no longer open.
vocab-use-buttons = Use the buttons above.
vocab-llm-failed = ⚠️ The language model did not answer properly. Try again?
vocab-learn-right = ✅ Right — <b>{ $word }</b> is in your review deck now.
vocab-learn-wrong = ❌ <b>{ $word }</b> means: { $answer }. It will come back soon in Review.
vocab-learn-done = 🎉 You have learned { $count } new words today. Add your own word or finish.
vocab-learn-no-words = There are no new words left at your level. Add your own word or finish.
vocab-review-header = 🔁 { $count } cards to review.
vocab-review-right = ✅ Correct.
vocab-review-wrong = ❌ The answer: <b>{ $answer }</b>
vocab-your-answer = Your answer: <i>{ $answer }</i>
vocab-check-unavailable = I could not check your answer automatically. The answer: <b>{ $answer }</b>
vocab-rate-prompt = How well did you know it?
vocab-rate-again = Again
vocab-rate-hard = Hard
vocab-rate-good = Good
vocab-rate-easy = Easy
vocab-pattern-prompt = ✍️ Fix this sentence, then check:
vocab-pattern-reveal = Show answer
vocab-pattern-answer = ✅ <b>{ $sentence }</b>
vocab-summary-new = +{ $count } new
vocab-summary-reviewed = { $count } reviewed
vocab-summary-accuracy = { $percent } %
vocab-summary-learn-empty = No new words this time.
vocab-review-nothing = Nothing to review right now.

# --- onboarding ---
onboarding-welcome = 👋 Welcome to EnglishCoach! A little English every day, with words, grammar and conversation. First, choose the language for the interface and explanations.
onboarding-provider = Which AI should run your lessons? The server's works out of the box; you can switch to your own key in Settings at any time.
onboarding-provider-server = Use the server (default)
onboarding-provider-own = Set up my own provider in Settings
onboarding-start-test = Start the test
onboarding-cancel = Cancel
onboarding-error = The test could not continue: the AI provider did not give a usable answer.
onboarding-retry = Try again
onboarding-continue = Continue
onboarding-words = How many new words per day?
onboarding-morning = When shall I start your morning session?
onboarding-evening = And your evening session?
onboarding-done = Welcome aboard!

# --- placement test ---
placement-intro = 🧭 Now the placement test: six short sections — grammar, vocabulary, reading, listening, writing and speaking — about 20 minutes, taken in one go. Lessons open when it is done. If you stop halfway, it starts again from the beginning.
placement-intro-retake = 🧭 The full placement test measures every skill again: six sections, about 20 minutes, taken in one go. Your levels change only when you finish it.
placement-section = Section { $n }/{ $total } · { $name }
placement-section-question = Section { $n }/{ $total } · { $name } · { $k }/{ $of }
placement-listen = 🎧 Listen to the voice note below, then answer.
placement-task-writing = ✍️ Write 3–5 sentences in English and send them as a message:
placement-task-speaking = 🎙 Answer with a voice message in English (30–60 seconds):
placement-needs-voice-listening = 🎧 This section plays short audio clips. Turn voice on to take it, or skip it — your listening level will then be a rough guess.
placement-needs-voice-speaking = 🎙 This section takes a voice answer. Turn voice on to take it, or skip it — your speaking level will then be a rough guess.
placement-voice-on = 🔊 Turn voice on
placement-skip-section = Skip this section
placement-writing-typed = Please type your answer for this section.
placement-speaking-voice = Please answer with a voice message.
placement-writing-short = A little more, please: 3–5 sentences.
placement-speaking-short = A little longer, please: 30–60 seconds.
placement-result = 🎯 Your level: { $level }
placement-result-skipped = ~ marks a skill the test did not measure; it settles as you practise.
placement-summary = Placement test: { $level }.

# --- grammar ---
grammar-pick-topic = ✍️ Grammar practice: 10 questions. Pick a topic or practise a mix.
grammar-mixed = 🎲 Mixed
grammar-next-review = 🔁 Review: { $topic }
grammar-next-shaky = 🟡 Firm up: { $topic }
grammar-next-new = ▶ Next: { $topic }
grammar-next-learning = ▶ Continue: { $topic }
grammar-topic-chosen = Topic: { $topic }
grammar-transfer-correct = ✅ Used correctly { $n }× { $source }
grammar-transfer-errors = ⚠️ Slips { $source } in the last 14 days: { $n }
grammar-transfer-in-talk = in conversation
grammar-transfer-in-writing = in writing
grammar-transfer-in-speaking = in speaking
grammar-question-header = ❓ Question { $n } of { $total }
grammar-chosen = Your answer: { $answer }
grammar-use-buttons = Please answer with the buttons above.
grammar-verdict-correct = ✅ Correct!
grammar-verdict-partial = ❌ Almost, but there is a slip.
grammar-verdict-wrong = ❌ Not quite.
grammar-correct-answer = Correct answer: { $answer }
grammar-severity = { $marker } Severity: { $label }
grammar-severity-critical = critical
grammar-severity-moderate = moderate
grammar-severity-minor = minor
grammar-card-added = 📌 This pattern keeps coming up — it is now in your Review.
grammar-summary = Grammar: { $correct }/{ $total }
grammar-summary-weak = Grammar: { $correct }/{ $total }, weak: { $weak }
grammar-error-quiz = ⚠️ I could not prepare the next question.
grammar-error-check = ⚠️ I could not check your answer. Send it again in a moment.
grammar-retry = 🔄 Try again
grammar-stop = ⏹ Stop
grammar-outdated = This question is outdated.

# --- talk ---
talk-pick-topic = What shall we talk about?
talk-topic-free = 🎲 Anything
talk-topic-routine = Daily routine
talk-topic-family = Family & friends
talk-topic-food = Food & cooking
talk-topic-travel = Travel
talk-topic-work = Work & career
talk-topic-tech = Technology
talk-topic-society = Society
talk-topic-future = The future
talk-topic-culture = Books & films
talk-finish = ✅ Finish
talk-corrections-title = Corrections
talk-no-errors = No errors — nice work!
talk-category-grammar = Grammar
talk-category-vocabulary = Vocabulary
talk-category-spelling = Spelling
talk-category-word_choice = Word choice
talk-category-punctuation = Punctuation
talk-category-expression = Expression
talk-tip-phrase = Useful phrase
talk-tip-grammar = Grammar tip
talk-tip-level_up = Level up
talk-tip-native_pitfall = Common mistake
talk-error = Sorry, I could not answer that. Please send your message again.
talk-text-only = I can only read text messages here for now.
talk-opener-fallback = Hi! What have you been up to today?
talk-summary-empty = Talk: no messages
talk-summary-title = Talk
talk-summary-messages = { $n ->
        [one] 1 message
       *[other] { $n } messages
    }
talk-summary-corrections = { $n ->
        [one] 1 correction
       *[other] { $n } corrections
    }
talk-summary-top = top: { $top }

# --- routine ---
routine-plan-morning = ☀️ Good morning! Today's plan:
routine-plan-evening = 🌙 Evening practice:
routine-plan-reviews = • cards to review: { $count }
routine-plan-words = • new words: { $count }
routine-plan-grammar = • grammar questions: { $count }
routine-plan-empty = Nothing is due right now — a short chat in English is a great way to practise.
routine-reminder = ⏰ Today's goal is still open. A few minutes now keep your streak going.
routine-start-morning = ▶️ Start morning set
routine-start-evening = ▶️ Start evening set
routine-later = ⏳ Later (1 h)
routine-snoozed = I'll remind you in an hour.
routine-outdated = This reminder is no longer active.

# --- progress ---
progress-level = 🎓 Level: { $level }
progress-level-unset = 🎓 Level: not set yet
progress-skills = 📊 { $list }
progress-skill-grammar = Grammar
progress-skill-vocabulary = Vocabulary
progress-skill-reading = Reading
progress-skill-listening = Listening
progress-skill-writing = Writing
progress-skill-speaking = Speaking
progress-streak = 🔥 Streak: { $current } (best: { $best })
progress-goal = 🎯 Today: { $done }/{ $goal } new words · { $reviews } reviews
progress-goal-met = ✅
progress-cards = 🗂 Cards: { $new } new · { $learning } learning · { $review } review
progress-due = ⏰ Due: { $today } today · { $tomorrow } tomorrow
progress-words = 📚 Words learned: { $count }
progress-known = 💯 Words known: { $count }
progress-activity = 📊 Last 7 days: { $spark }
progress-grammar = ✍️ Grammar accuracy: { $week } (7 days) · { $month } (30 days)
progress-weak-title = ⚠️ Top weak spots:
progress-weak-item = • { $pattern } ×{ $count }
progress-weak-none = No mistakes recorded yet — nothing to practise.
progress-btn-weak = 🎯 Weak spots
progress-weak-screen-title = 🎯 Weak spots
progress-weak-line = { $n }. { $pattern } ×{ $count }{ "\u000A" }❌ { $wrong }{ "\u000A" }✅ { $right }

# --- profile ---
profile-title = 👤 Profile
profile-level = ⭐ Level { $level } · { $xp } XP
profile-xp-bar = { $bar } { $into }/{ $needed } XP to level { $next }
profile-streak = 🔥 Streak: { $current } (best: { $best })
profile-cefr = 🎓 English: { $level }
profile-cefr-unset = 🎓 English: level not set yet
profile-skill = • { $skill }: { $level }
profile-skill-seeded = • { $skill }: ~{ $level }
profile-achievements-title = 🏆 Latest achievements
profile-achievement = • { $title }
profile-achievements-none = No achievements yet — your first one is a session away.
profile-achievements-btn = 🏆 Achievements
profile-totals-title = 📦 All time
profile-totals = 📚 { $words } words learned · 🔁 { $reviews } reviews · ✍️ { $grammar } grammar answers · 🎯 { $days } goal days

# --- achievements ---
achievements-title = 🏆 Achievements · { $unlocked } of { $total } unlocked
achievements-page = Page { $page } of { $pages }
achievements-progress = { $bar } { $value }/{ $threshold } → { $title }
achievements-topics = 🧩 Grammar topics mastered: { $count } of { $total }
achievements-secrets = 🔒 Secret achievements found: { $count } of { $total }
achievements-prev = ◀️ Back
achievements-next = Next ▶️
achievements-back = 👤 Profile
hub-achievements-unlocked = 🏆 Unlocked: { $list }
hub-achievements-more = { $list } and { $count } more

progress-btn-practice = ✍️ Practice these
progress-practice-none = Nothing to practise yet.
grammar-practice-intro = ✍️ Practising your weak spots ({ $count } patterns), one question each in turn.

# --- voice ---
voice-listen = 🔊 Listen
voice-listen-example = 🔊 Example
voice-transcript = 🎤 { $text }
voice-needs-key = Voice answers and pronunciation need an OpenAI-compatible API key. Add one in Settings → Provider, then try again. Meanwhile, type your answer.
voice-too-long = That voice message is too long. Keep it under { $seconds } seconds, or type your answer.
voice-stt-failed = I could not transcribe that voice message. Try again or type your answer.
voice-empty = I could not hear any words in that voice message. Try again or type your answer.
voice-tts-failed = I could not generate the pronunciation right now. Try again later.
voice-disabled = Voice is off. Turn it on in Settings.
voice-outdated = This button is no longer available.
voice-board-running = 🔊 Voicing the word list — running
voice-board-idle = 🔊 Voicing the word list — paused until the next run
voice-board-words = Words: { $done } / { $total } ({ $percent }%) { $bar }
voice-board-examples = Examples: { $done } / { $total } ({ $percent }%) { $bar }
voice-board-remaining = Remaining: { $remaining } · ETA: { $eta }
voice-board-eta = about { $hours } h { $minutes } min at { $rate } per hour
voice-board-eta-unknown = unknown (nothing generated in the last hour)
voice-board-eta-none = done
voice-board-recent = Generated today: { $today } · last 24 h: { $day }
voice-board-failures = Failures today: { $count }
voice-board-engine = Engine: { $engine } · voice: { $voices }
voice-board-updated = Updated: { $time } UTC

# --- answer feedback (one answer at a time) ---
answer-accepted = Answer “{ $answer }” accepted
answer-chosen = ✅ { $answer }
answer-preparing = ⏳ Preparing the next question…
answer-busy = Wait, preparing the next question
answer-stale = This question is already answered
answer-starting = ⏳ Getting it ready…
settings-models-loading = ⏳ Loading models…

## Learner profile (onboarding and Settings → Profile & goals)

onboarding-goals = 🎯 Why are you learning English? Choose everything that fits, then tap Next.
onboarding-goals-empty = Choose at least one goal
onboarding-interests = 💡 What are you into? Tap the topics or type your own, separated by commas (up to { $max }). Examples and texts will be about them.
onboarding-profession = 💼 What do you do for a living? Type your profession or job title, or skip.
onboarding-next = Next ›
onboarding-skip = Skip
onboarding-use-buttons = Please use the buttons above.
goal-it = 💻 IT
goal-travel = ✈️ Travel
goal-work_business = 💼 Work & business
goal-exam = 📝 Exam
goal-everyday = 🗣 Everyday English
goal-relocation = 🏠 Relocation
interest-technology = Technology
interest-music = Music
interest-movies = Movies & series
interest-books = Books
interest-sports = Sports
interest-travel = Travel
interest-cooking = Cooking
interest-games = Games
interest-science = Science
interest-business = Business
interest-art = Art
interest-health = Health & fitness
settings-btn-profile = 👤 Profile & goals
profile-goals-title = 👤 Profile & goals
profile-goals = Goals: { $goals }
profile-interests = Interests: { $interests }
profile-profession = Profession: { $profession }
profile-none = —
profile-btn-interests = 💡 Interests
profile-btn-profession = 💼 Profession
profile-btn-clear-profession = Clear profession
profile-interests-title = 💡 Interests, up to { $max }. Tap a topic to add or remove it, or type your own.
profile-btn-type-interests = ✏️ Type my own
profile-btn-clear = Clear all
profile-interests-full = Up to { $max } interests
input-interests = Send your interests, separated by commas, e.g. football, jazz, startups (up to { $max }).
input-profession = Send your profession or job title (current: { $profession }).
input-interests-invalid = Send short topics separated by commas, each up to 40 characters.
input-profession-invalid = Send your profession in one line, up to 80 characters.
