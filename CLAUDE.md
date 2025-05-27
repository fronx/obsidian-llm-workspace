# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Important Architecture Notes

### System Prompt Handling
The system prompt can be customized by users through the settings. Therefore:
- DO NOT modify `DEFAULT_SYSTEM_PROMPT` in `src/config/prompts.ts` to add new instructions
- Instead, add any necessary instructions to the augmented system prompt in `src/llm-features/conversation.ts`
- Look for where `systemPromptWithInstructions` is constructed - this is where we append date/time and other runtime instructions

### Model Capabilities
The LLM has the following capabilities and limitations:
- Can SEARCH notes using semantic search (returns only 150-char previews)
- CANNOT read full content of arbitrary notes (except daily notes)
- Can read/edit daily notes for journal entries
- Users must use "Add context" button to share full note content

## General Instructions

Start reading @.agents/README.md and follow the links for more architectural details.
