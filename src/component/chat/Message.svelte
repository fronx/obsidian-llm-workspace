<script lang="ts">
	import type { ChatMessage } from "src/rag/llm/common"
	import ObsidianIcon from "../obsidian/ObsidianIcon.svelte"
	import ObsidianMarkdown from "../obsidian/ObsidianMarkdown.svelte"
	import path from "node:path"

	let {
		message,
		onCopy,
		onEdit,
	}: {
		message: ChatMessage
		onCopy: (msg: string) => void
		onEdit: (msg: string) => void
	} = $props()

	let toolOutputExpanded = $state(false)
</script>

<div class="flex flex-row items-baseline">
	{#if message.role === "user"}
		<ObsidianIcon iconId="user" size="s" className="mr-2 flex-none relative top-0.5" />
	{:else if message.role === "assistant"}
		<ObsidianIcon iconId="sparkles" size="s" className="mr-2 flex-none relative top-0.5" />
	{/if}
	<ObsidianMarkdown
		source={message.content}
		className={(message.role === "user" ? "text-accent font-medium" : "") + " grow select-text"}
	/>
</div>
<div class="flex w-full flex-row pl-5">
	<div class="flex flex-grow flex-row flex-wrap gap-1">
		{#each message.attachedContent as file (file.parent)}
			<div
				class="flex flex-row items-center rounded border border-solid border-border bg-primary px-1 py-0.5 text-sm"
			>
				{path.basename(file.parent, path.extname(file.parent))}
			</div>
		{/each}
	</div>

	{#if message.role === "assistant"}
		<button
			class="clickable-icon"
			onclick={() => onCopy(message.content)}
			aria-label="Copy response"
			data-tooltip-delay="300"
		>
			<ObsidianIcon iconId="copy" size="s" />
		</button>
	{:else if message.role === "user"}{/if}
</div>

{#if message.toolOutputs && message.toolOutputs.length > 0}
	<div class="ml-5 mt-2">
		<button
			class="flex items-center gap-1 text-sm text-muted hover:text-normal"
			onclick={() => toolOutputExpanded = !toolOutputExpanded}
		>
			<ObsidianIcon 
				iconId={toolOutputExpanded ? "chevron-down" : "chevron-right"} 
				size="xs" 
			/>
			Tool details ({message.toolOutputs.length} {message.toolOutputs.length === 1 ? 'action' : 'actions'})
		</button>
		
		{#if toolOutputExpanded}
			<div class="mt-2 border-l border-border pl-3 text-sm">
				{#each message.toolOutputs as output}
					<pre class="whitespace-pre-wrap font-mono text-xs text-muted mb-2">{output}</pre>
				{/each}
			</div>
		{/if}
	</div>
{/if}
