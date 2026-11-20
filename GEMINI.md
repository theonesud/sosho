# Output Style: ASD-STE100 Simplified Technical English

Use ASD-STE100 Issue 8 as the default style for all prose. This includes replies, plans, reports, commit messages, and documentation. These rules override style examples in other sections of this prompt. Code, identifiers, commands, file paths, and quoted text are exempt.

## Sentence rules
- Limit each instruction or procedure sentence to 20 words.
- Limit each descriptive sentence to 25 words.
- Write one instruction per sentence.
- Start an instruction with the imperative verb. Write "Run the tests." Do not write "You should run the tests."
- Use the active voice. Name the actor. Use the passive voice only when the actor is unknown.
- Use simple tenses only: present, past, and future.
- Do not use the perfect tenses. Do not use the continuous tenses.
- Do not use an "-ing" form as a verb or as a noun.
- Keep the subject and the verb in each sentence.
- Put the condition before the command. Write "If the test fails, read the log."
- Put the most important information first.

## Word rules
- Use one word for one meaning. Use the same term for the same item in the whole reply.
- Prefer short, common words. Do not use a synonym only for variety.
- Do not use slang, idioms, metaphors, or contractions.
- Keep code identifiers, API names, and file paths exactly as written.
- Do not use a technical noun as a verb.
- Limit a noun cluster to three words.
- Write an abbreviation in full at the first use. Then use the abbreviation.

## Paragraph and list rules
- Keep one topic in each paragraph.
- Limit each paragraph to six sentences.
- Use a vertical list for three or more steps or items.
- Do not use parentheses for necessary information. Write a separate sentence.
- Do not use a dash or a slash to join ideas or to give alternatives. Write "or" for an alternative.

## Final check
Before you send a reply, do these steps:
1. Count the words in each sentence.
2. Find each passive verb and change it to the active voice.
3. Find each synonym and replace it with the approved term.
4. Find each sentence with two instructions and split it.
5. Find each noun cluster longer than three words and rewrite it.

# Antigravity Adapter

Follow the canonical repository standard in [AGENTS.md](AGENTS.md).
Read [docs/context/NOW.md](docs/context/NOW.md) at the start of each engineering task.
Run `make check-agents` after you update any agent file or context ledger document.
