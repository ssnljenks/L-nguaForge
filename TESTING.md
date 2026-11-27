# Manual test plan: first tester

You are the first real user. This plan has four parts: **setup**, a **15-minute smoke test**, a **checklist for each tab**, and a **try-to-break-it** section. A bug-report template is at the end.

Priorities: the smoke test on an iPhone and on an Android phone first. If those pass, work through the tabs. If something is wrong, write down _what you did, what you expected, what happened_; the template makes that quick.

Ground rules while testing:

- Use practice content only. Never type or say anything real and sensitive: the app is not a place for classified or controlled information (it will refuse markings, and that is tested below).
- "Voice" means speaking to the phone. "Type" means the on-screen keyboard. When a step says _you should see_ and you don't, that is the bug: write it down even if it seems small.
- Finish a step before judging the next one; one failure often explains several others.

---

## 0. Setup (5 minutes, once)

| #   | Do                                                                                                                                                                                                                                                         | Why                                                                        |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 0.1 | Have the URL, the time zone you'll test in, and headphones plus a quiet room. Know your device, OS and browser versions (iPhone: Settings › General › About; Android: Settings › About phone).                                                             | Every bug report needs them.                                               |
| 0.2 | Test on up to three setups: **iPhone Safari (a normal tab)**, **iPhone home-screen app** (Share › Add to Home Screen, then open it from the icon), **Android Chrome**. Do the whole smoke test once per setup. A desktop browser is optional.              | The mic, speech and audio rules differ between them (see READINESS.md §1). |
| 0.3 | iPhone: Settings › General › Keyboard › **Enable Dictation: on**. Note where the ring/silent switch is: you'll test with it on _and_ off.                                                                                                                  | Voice input and sound depend on both.                                      |
| 0.4 | Start from a clean slate for the first launch only: a private/incognito tab, or the gear button › Reset Local Data in the app. **Reset Local Data erases your vocab, sessions and settings and there is no export** (Vocab's Anki CSV is the only backup). | S-1 checks the new-user experience. Don't reset an account you care about. |
| 0.5 | Open the app once with Wi-Fi, then once on cellular.                                                                                                                                                                                                       | Different networks, different failures.                                    |
| 0.6 | Keep this file open next to the app, or note timestamps and step IDs as you go.                                                                                                                                                                            | Server logs are searched by time; step IDs tell me where you were.         |

**Server side (for me):** failures are logged. In Cloud Logging, `jsonPayload.event="client_error"` shows crashes reported by the phone (`platform`, `standalone`, `tab`, `message`); `jsonPayload.event="gemini_failure"` and `"api_rate_limited"` show server-side trouble. Logs never contain what you said or typed.

---

## 1. The 15-minute smoke test

Do it in order, once per setup. Tick each box; if a step fails, note the ID and keep going unless the app is unusable.

| ID        | Min | Do                                                                                                                                                                          | You should see                                                                                                                                                                                                                                                                | If wrong, note                                                                                                                                                |
| --------- | --: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ☐ **S-1** |   1 | Open the URL on a clean profile.                                                                                                                                            | A data-safety notice first (accept it). Today opens with an ILR profile where Speaking shows **"—"** (not a level), then a three-item plan and a bottom bar "Start today's plan". iPhone: add to home screen and reopen from the icon: same screen, no browser bars.          | What blocked you; whether the notice or the install prompt looked wrong; anything cut off by the notch or the home bar.                                       |
| ☐ **S-2** |   2 | On Today, tap **Start today's plan**, open the vocab warm-up and do 3 cards. Tap the speaker on a card.                                                                     | Cards show a term and a way to rate recall; the speaker reads the Spanish aloud. After the 3rd card you return to the plan with step 1 marked done.                                                                                                                           | Whether sound played; which card; whether progress was kept.                                                                                                  |
| ☐ **S-3** |   1 | Open **Settings** (the gear button, "Mission Settings"). Under Voice & Audio, tap **Test Voice**. Do it with the iPhone ring/silent switch **on**, then **off**.            | You hear a Spanish sentence. With the switch on it may be silent: note it (that's a finding, not your mistake).                                                                                                                                                               | Silent switch on/off result; which voice was chosen.                                                                                                          |
| ☐ **S-4** |   3 | **Talk** › pick a tutor and a scene › **Start Live Voice**. Allow the microphone if asked. Say 2–3 sentences in Spanish, then interrupt the tutor once while it is talking. | Status goes Connecting → Listening. The tutor greets you aloud within a few seconds. Your words and the tutor's appear in the transcript. Interrupting makes the tutor stop and listen. A level meter or waveform moves. **End live voice conversation** ends it cleanly.     | Time to first sound; whether you heard anything; whether the transcript matched what you said; earpiece vs loudspeaker.                                       |
| ☐ **S-5** |   1 | Still in Talk: tap **Type instead**, send one message. Tap a dotted word in the tutor's reply and **Save to Vocab**.                                                        | A reply arrives, possibly with a short recast note. The word card opens; after saving the button says "Already in Vocab".                                                                                                                                                     | Reply time; whether the dotted word was tappable.                                                                                                             |
| ☐ **S-6** |   1 | **Test prep** › OPI **Exam** › **Start the call**.                                                                                                                          | A phone-call screen: orb, timer, Mute / End call / Repeat, no transcript and no hints. You **hear the examiner's question**. If the browser refuses to play it, a **Tap to hear the examiner** button and a "Show the question as text" link appear instead.                  | Did you hear it by itself? Did the button appear? Which volume/route?                                                                                         |
| ☐ **S-7** |   2 | Answer two questions **by voice**, then repeat one answer by **typing** (iPhone: typing should already be open; use the keyboard's mic key if you like).                    | Status says "Listening to you…" and your words appear in the answer box as you speak; **Send** submits; the examiner answers. On a long silence the app keeps listening (it restarts itself). If voice never works, a clear message appears and typing is open.               | **iPhone: do voice input and the call's audio work at the same time?** Any message shown; whether words appeared; whether it stopped listening after a pause. |
| ☐ **S-8** |   2 | **End call.**                                                                                                                                                               | The debrief opens by itself: a level card labelled "Practice estimate, not an official rating", a "Where it broke down" moment, a six-function grid. Android: a **Play** button for the breakdown clip works. iPhone: a note says replay clips aren't recorded on iPhone yet. | Long wait or error at the debrief; whether Retry worked; clip behaviour.                                                                                      |
| ☐ **S-9** |   2 | **Brief** › Listening: play one card's audio. Then **Vocab**: check the entry you saved in S-5 is there and do one **Recall** card.                                         | The audio plays (or says "Stream unavailable" with a link); the saved word is in the Library; Recall accepts a sentence and gives feedback.                                                                                                                                   | Which card/publisher; whether audio played; any error text.                                                                                                   |

**Pass bar for the beta:** S-1…S-9 pass on at least one iPhone setup and the Android phone, apart from the iPhone items already marked as known limits in READINESS.md §1. A **fail on S-4, S-6 or S-7** means voice is broken on that device: stop and report it first.

---

## 2. Checklists by tab

Each row: do it, check it, and if it's wrong write down the italic part. Tick what passes.

### Today

| ID    | Do                                                                          | You should see                                                                                                                                                | If wrong, note                                                     |
| ----- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| ☐ T-1 | Open Today on a fresh profile.                                              | ILR profile card: Listening/Reading/Speaking. Speaking is "—" until you've done a speaking session. No military or work wording anywhere (Work focus is off). | _Any level shown for a new user; any military words._              |
| ☐ T-2 | Read the three plan items.                                                  | Vocab, Brief and Speaking, each with minutes and a subtitle. The total time is sensible.                                                                      | _Missing item, odd totals, text cut off._                          |
| ☐ T-3 | Open each plan item from the plan.                                          | Each opens the right activity; a "back to plan" chip returns you; completed steps are ticked.                                                                 | _Wrong screen, no way back, tick missing._                         |
| ☐ T-4 | If the Speaking item is a **2-min fix**: run all 8 prompts, voice or typed. | Prompts are everyday topics; each answer gets feedback; it ends at 8 / 8 with a score; "Run another 8" works.                                                 | _Prompt that is military; a prompt that failed to load; no retry._ |
| ☐ T-5 | Open **Recurring errors** (after a few sessions).                           | A ranked list of your most frequent mistakes with examples; empty-state text before you have any.                                                             | _Wrong ranking; empty screen with no explanation._                 |
| ☐ T-6 | Set a test date in Settings and return.                                     | A countdown or date appears; clearing it removes it.                                                                                                          | _Date not shown, wrong day._                                       |
| ☐ T-7 | Next day (or change the device date): reopen Today.                         | A new plan and unticked steps.                                                                                                                                | _Yesterday's plan still shown._                                    |

### Talk

| ID    | Do                                                                                 | You should see                                                                                                                | If wrong, note                                                |
| ----- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| ☐ K-1 | Open Talk. Pick a tutor, a scene, a slang level, a correction style.               | Selections stay highlighted. "Work talk" does **not** appear while Work focus is off.                                         | _Work talk visible with Work focus off._                      |
| ☐ K-2 | Start Live Voice (S-4 in detail): speak, pause for 5 s, speak again, mute, unmute. | Mic level reacts; muted shows "Microphone muted"; the tutor does not answer while muted; speaking again works.                | _What happened after the pause; whether mute actually muted._ |
| ☐ K-3 | Keep a Live conversation going for 3 minutes.                                      | The transcript keeps growing; tips ("recast") appear for your mistakes; no gaps in the audio.                                 | _Where audio stuttered or lagged; any message._               |
| ☐ K-4 | Type a message while Live is running.                                              | The tutor answers it in voice.                                                                                                | _No answer; wrong language._                                  |
| ☐ K-5 | Type `SECRET//NOFORN test` and send.                                               | A friendly message explaining it can't be sent; the text stays editable; nothing is sent to the AI.                           | _Message sent anyway; unfriendly error._                      |
| ☐ K-6 | **How do locals say…**: ask for "that's awesome".                                  | A few regional options with when to use each; the speaker reads them; you can save one.                                       | _Empty result, long wait, no retry on failure._               |
| ☐ K-7 | **Wrap up** the conversation.                                                      | A short summary and a checklist of words and phrases; **Add N to Vocab** puts them in Vocab with the sentence they came from. | _Items missing; added items not in Vocab._                    |
| ☐ K-8 | Reload the page mid-conversation.                                                  | The thread is still there after reload.                                                                                       | _Conversation lost._                                          |

### Test prep

| ID    | Do                                                                                        | You should see                                                                                                                                                                             | If wrong, note                                                  |
| ----- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| ☐ P-1 | OPI **Exam**: run S-6 to S-8 fully (10+ minutes if you can).                              | No transcript, hints or level shown during the call. The call winds down by itself near the time limit. The debrief opens automatically.                                                   | _Level shown in Exam mode; call that never ended._              |
| ☐ P-2 | Tap **Repeat** during the examiner's turn, and again after.                               | The examiner repeats or rephrases the last question.                                                                                                                                       | _Silence; a different question; button stuck._                  |
| ☐ P-3 | OPI **Practice**: try focus levels 1, 2, 3 and Adaptive; use **Stuck? Hold for a hint**.  | A live transcript; tapping an examiner word shows a meaning and **Save to Vocab**; the hint drawer offers phrases.                                                                         | _Word lookup that fails; hints that are in the wrong language._ |
| ☐ P-4 | Debrief: **Redo this answer**.                                                            | Type a better answer, tap **Grade Redo vs Original**; you get a verdict. **Past sessions** lists the call.                                                                                 | _Grade fails; session missing from the list._                   |
| ☐ P-5 | **Role-play**, levels 1, 2, 3. Start, answer 3–4 turns, End call.                         | An everyday civilian scene (never military). Level 2–3: a complication appears roughly a third of the way in. The debrief reveals the hidden goal and complication and a 3-item checklist. | _Military content; complication never appears; debrief errors._ |
| ☐ P-6 | After a role-play debrief, **replay with the twist**.                                     | The same scenario starts again with the twist known; it plays normally.                                                                                                                    | _"No longer available" message right after the debrief._        |
| ☐ P-7 | **PREP & Interp Lab**: generate a PREP prompt, speak or type a 1-minute answer, grade it. | A structure score and feedback. Interpretation: a short briefing, your rendering, a grade.                                                                                                 | _Grading never returns; recorder fails._                        |
| ☐ P-8 | OPI via **Today › Brief it back** (if offered).                                           | The call starts about a Brief story; the story title is shown.                                                                                                                             | _Wrong story or no audio._                                      |

### Brief

| ID    | Do                                                                                    | You should see                                                                                                                                             | If wrong, note                                                   |
| ----- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| ☐ B-1 | Open Brief. Switch **Listening ↔ Reading**; use the level and topic chips and search. | Cards change; search waits a moment after you stop typing; "No passages" appears only when the filters really match nothing, with a Reset button.          | _A request error shown as "no passages"; chips that do nothing._ |
| ☐ B-2 | Tap **Refresh**.                                                                      | "Checking feeds…" then an updated time; or a clear error with **Try again**.                                                                               | _Spinner that never stops; silent failure._                      |
| ☐ B-3 | Play a Listening card.                                                                | Audio plays from the publisher, or "Stream unavailable" and a link.                                                                                        | _Publisher name; whether it played on this device._              |
| ☐ B-4 | Open the **study sheet** of a Reading card.                                           | An excerpt (not the whole article) with a link to the source.                                                                                              | _Full article copied; no link._                                  |
| ☐ B-5 | **DLPT drill, listening**: play once, answer a question, try to go back.              | Audio plays once only; there is no Back; Next appears only after you answer. Feedback depends on practice vs test mode.                                    | _Audio replays in test mode; Back available._                    |
| ☐ B-6 | **DLPT drill, reading**: flag a passage, finish, open the review.                     | The end-of-session review lists flagged items.                                                                                                             | _Flag lost._                                                     |
| ☐ B-7 | **Gist**: listen once, write 3 English sentences within 60 s, submit.                 | A countdown starts when the audio ends; grading lists omissions, additions (first) and distortions with quotes. A failed grading returns you to your text. | _Timer wrong; your text lost after an error._                    |
| ☐ B-8 | **Brief it back** from a card.                                                        | Opens an OPI about that story.                                                                                                                             | _Wrong story._                                                   |

### Vocab

| ID    | Do                                                                                                    | You should see                                                                                                                                                              | If wrong, note                                                                               |
| ----- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| ☐ V-1 | Open Vocab on a fresh profile.                                                                        | A starter list with "N saved · N due today"; category chips; search.                                                                                                        | _Empty list for a new user._                                                                 |
| ☐ V-2 | Search, filter by category, tap a word.                                                               | Meaning, example, register tag; a speaker button reads it.                                                                                                                  | _No sound; wrong meaning._                                                                   |
| ☐ V-3 | **Add Vocab Entry**.                                                                                  | The new entry appears and is counted.                                                                                                                                       | _Entry lost after reload._                                                                   |
| ☐ V-4 | **Recall**: write a sentence for a card, submit.                                                      | Natural / not natural, a polished version, and the card's schedule updates (due count changes).                                                                             | _No feedback; error with no way to retry._                                                   |
| ☐ V-5 | Delete or hide every entry (or clear storage).                                                        | An empty state that says how to add words; the review button is disabled.                                                                                                   | _Blank screen; a button that crashes._                                                       |
| ☐ V-6 | **Export Anki CSV**.                                                                                  | A CSV downloads or shares and opens with your words.                                                                                                                        | _No file on iPhone._                                                                         |
| ☐ V-7 | With Work focus **off**, look at the Vocab mode tabs and category chips. Then turn Work focus **on**. | Off: only Library and Active Recall, and no Operational/Military Terms chip; saved military words still appear under All Categories. On: Military Dict and the chip appear. | _Military Dict or the chip visible with Work focus off; a saved word missing from the list._ |

### Settings

| ID    | Do                                                                                 | You should see                                                                                           | If wrong, note                             |
| ----- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| ☐ G-1 | Change **language** (Spanish ↔ Portuguese) and **dialect**.                        | The mission chip updates; Today, Talk tutors, Brief and Vocab all switch language.                       | _Something still in the old language._     |
| ☐ G-2 | Toggle **Work focus** on, then off.                                                | With it on, a domain choice and work items appear; with it off, no domain, no military framing anywhere. | _Military text with it off._               |
| ☐ G-3 | **Test Voice**, change **Browser voice**, **Speech rate**, **Live voice partner**. | The test sentence uses the chosen voice and speed; Live voice uses the chosen partner in your next call. | _Voice list empty; rate ignored._          |
| ☐ G-4 | Set ILR goals and a test date.                                                     | Today reflects them.                                                                                     | _Not reflected._                           |
| ☐ G-5 | **Offline dictionary** section.                                                    | Shows counts of built-in and cached words.                                                               | _Zero counts._                             |
| ☐ G-6 | Reset tab intros, then open each tab.                                              | The short intro appears once per tab.                                                                    | _Intro loops._                             |
| ☐ G-7 | Install the app (Android: install prompt; iPhone: Share › Add to Home Screen).     | Icon on the home screen; opens full-screen.                                                              | _Wrong icon or name; address bar visible._ |
| ☐ G-8 | **Last:** Reset Local Data (only on a throwaway profile).                          | Everything returns to first-launch state.                                                                | _Anything that survives; a crash._         |

---

## 3. Try to break it

Do these deliberately. For each: say what you did, what the app told you, and whether you lost anything. **A good result is a clear message, nothing lost, and a way to carry on**; a bad result is a frozen screen, a spinner that never ends, a vanished answer, or a message that blames the wrong thing.

### Bad network

| ID    | Do                                                                                                                                             | A good result                                                                                                                                       |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| ☐ N-1 | Start an OPI call on Wi-Fi, walk out of range or switch Wi-Fi off while the examiner is "thinking".                                            | A message ("You're offline…" or "Can't reach LinguaForge…"); your answer is still in the box; after reconnecting, Send works.                       |
| ☐ N-2 | Use a very slow connection: iPhone Settings › Developer › Network Link Conditioner (or Android: Low data / throttled network). Do S-4 and S-6. | Slow but no stuck "Connecting…" forever: after about 15 s Live voice says it couldn't connect; REST screens say it took too long and let you retry. |
| ☐ N-3 | Switch from Wi-Fi to cellular (or the reverse) during a Live voice call.                                                                       | The call ends with "connection dropped… conversation so far is saved". **Start Live Voice** works again. Typing works throughout.                   |
| ☐ N-4 | Join a captive Wi-Fi (hotel/airport style) that hasn't been signed in to; open the app.                                                        | A sensible error, not a blank page. After signing in, a reload works.                                                                               |
| ☐ N-5 | Turn a VPN on or off mid-session.                                                                                                              | Same as N-3.                                                                                                                                        |

### Airplane mode

| ID    | Do                                                                                          | A good result                                                                                                        |
| ----- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| ☐ A-1 | Open the app once (online), close it, turn airplane mode on, open it again.                 | The app opens from its cache; an "Offline Mode" banner; Vocab (including Recall and local word lookups) still works. |
| ☐ A-2 | In airplane mode try Talk typed, an OPI call, Brief Refresh, a drill that needs the server. | Each says it's offline; none spins forever; Talk keeps your typed line for resending.                                |
| ☐ A-3 | Go to airplane mode **during** an OPI answer, then off again.                               | The error appears; your answer is kept; Send works after reconnecting.                                               |
| ☐ A-4 | Go to airplane mode **during** Live voice.                                                  | Ends immediately with "You went offline…" and keeps the transcript.                                                  |

### Interrupt the AI

| ID    | Do                                                                                                             | A good result                                                                                       |
| ----- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| ☐ I-1 | Talk over the tutor in Live voice repeatedly.                                                                  | The tutor stops and listens each time; the transcript is not garbled into one block.                |
| ☐ I-2 | Mute and unmute rapidly while the examiner speaks.                                                             | No double voices; Listening resumes when unmuted.                                                   |
| ☐ I-3 | Tap **Repeat** twice quickly; tap **Send** twice quickly; tap **End call** while "thinking".                   | One request each; no duplicate turns; the call ends and still opens a debrief of what was said.     |
| ☐ I-4 | Tap **Start Live Voice** five times fast; open Talk on two devices at once and start Live on both and a third. | One session per tap; the app says you already have the maximum open sessions (limit 2 per network). |
| ☐ I-5 | Start the examiner speaking, then tap another tab.                                                             | Speech stops when you leave; nothing keeps talking in the background.                               |

### Switch language mid-session

| ID    | Do                                                                                                | A good result                                                                                                    |
| ----- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| ☐ L-1 | During a Talk conversation (typed, then Live), switch Spanish ↔ Portuguese from the mission chip. | The old call stops cleanly; the new language starts fresh; the earlier thread isn't mixed in; no stale tip card. |
| ☐ L-2 | During an OPI call, look for any way to change language.                                          | The call screen covers the app, so there should be none. If you find one, the call must end cleanly first.       |
| ☐ L-3 | Switch and open Today, Brief, Vocab.                                                              | Each shows only that language's content; speech uses that language's voice.                                      |

### Lock the phone during a call

| ID    | Do                                                                                                                                        | A good result                                                                                                                                         |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| ☐ Z-1 | **Do nothing for 2 minutes** during a Live call and an OPI call (don't touch the screen).                                                 | The screen stays on (the app asks the phone not to sleep). If it locked anyway, note the phone's Auto-Lock setting.                                   |
| ☐ Z-2 | Press the side button to lock for 10 seconds, then unlock, during Live voice.                                                             | Either the call carries on, or within a couple of seconds it says "Live voice paused while the app was in the background…" with your transcript kept. |
| ☐ Z-3 | Lock for 5 minutes, then unlock.                                                                                                          | The same message; **Start Live Voice** works again.                                                                                                   |
| ☐ Z-4 | Lock during an OPI call while the examiner is speaking.                                                                                   | When you return, you can still answer, tap Repeat, or End call; nothing is lost.                                                                      |
| ☐ Z-5 | Switch to another app for 30 seconds, take a phone call, receive a Siri/alarm sound, plug in or remove headphones or Bluetooth, mid-call. | The app recovers or tells you why it couldn't. Audio comes back through the right speaker after.                                                      |

### Permissions and odd input

| ID    | Do                                                                                                                  | A good result                                                                                                                                                    |
| ----- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ☐ X-1 | Deny the microphone at the prompt, then try Live voice, an OPI call and the PREP recorder.                          | Each explains how to allow it for your phone and offers typing; none is stuck on "Connecting…".                                                                  |
| ☐ X-2 | Allow, start a call, then revoke the microphone in system settings.                                                 | The call says the microphone stopped; your transcript is kept.                                                                                                   |
| ☐ X-3 | Paste 5,000 characters into a Talk message; send an empty message; send only emoji; send English in a Spanish call. | Long text is accepted or trimmed gracefully; empty is ignored; nothing crashes; the AI keeps to the target language.                                             |
| ☐ X-4 | Tap words in the transcript 30+ times within a minute.                                                              | After a point: "Too many requests. Please wait a minute…". Local lookups still work. The limit lifts within a minute.                                            |
| ☐ X-5 | Leave a Live call running to the 15-minute limit.                                                                   | A message that the session is limited to 15 minutes, with your transcript kept.                                                                                  |
| ☐ X-6 | Rotate the phone; use a large text size (iPhone: Settings › Display & Brightness › Text Size); dark and light mode. | Nothing hidden behind the on-screen keyboard (Send stays reachable); text is readable.                                                                           |
| ☐ X-7 | Change the device clock a day forward, or leave the app open past midnight.                                         | Today shows a new plan; nothing breaks.                                                                                                                          |
| ☐ X-8 | Use a private/incognito tab; close and reopen it.                                                                   | Works while open; your data is gone after closing (that's expected; note if anything else differs).                                                              |
| ☐ X-9 | After I tell you a new build is deployed, open the app that was already installed.                                  | An update prompt appears; after accepting, your data is intact. If a Live call or role-play was running during the deploy, it ends with a clear message (known). |

---

## 4. Bug report template

Copy this for each problem. One report per problem; short is fine.

```text
Title: <what went wrong, in one line>

When (date, time, time zone):
Device and OS:            e.g. iPhone 14, iOS 18.3
Browser / how opened:     Safari tab | home-screen app | Chrome tab | installed Chrome app
App build / URL:
Network:                  Wi-Fi | cellular | airplane | VPN | slow
Microphone permission:    allowed | denied | not asked
Phone's silent switch / headphones / Bluetooth:

Where: tab › screen › step ID (e.g. Test prep › OPI Exam call › S-7)
Language / dialect / Work focus on or off:

What I did (numbered steps):
1.
2.
3.

What I expected:
What happened instead:
Message shown (copy it exactly):

How often:                always | sometimes | once
Did I lose anything?      nothing | a typed answer | a conversation | saved words | other
Could I carry on?         yes, easily | yes, with a workaround (say how) | no, had to reload | no, had to reset

Screenshot or screen recording attached:  yes | no

Severity (my guess):
  blocker   can't use the app or a whole feature on this device
  major     a feature works badly or loses my work
  minor     wrong wording, layout, small glitch
  idea      not a bug
```

**Severity guide for triage:** a failed S-4, S-6 or S-7, or any lost conversation or saved word, is **blocker/major**. Wrong or missing explanation text, layout slips, and slow responses are **minor** unless they stop you.
