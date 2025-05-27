<script lang="ts">
	import { MarkdownRenderer } from "obsidian"
	import { appStore, viewStore } from "src/utils/obsidian"

	let {
		source,
		className = "",
	}: {
		source: string
		className?: string
	} = $props()

	let markdownEl: HTMLElement | undefined

	$effect(() => {
		if (!markdownEl) return
		
		markdownEl.replaceChildren()
		const sourcePath = $appStore.workspace.getActiveFile()?.path || ""
		MarkdownRenderer.render($appStore, source, markdownEl, sourcePath, $viewStore)
	})
	
	// Handle internal link clicks
	function handleLinkClick(e: MouseEvent) {
		const target = e.target as HTMLElement
		if (target.tagName !== 'A' || !target.classList.contains('internal-link')) return
		
		e.preventDefault()
		const href = target.getAttribute('data-href') || target.getAttribute('href')
		if (!href) return
		
		// Ensure .md extension for note names without paths
		const linkPath = href.includes('.') ? href : `${href}.md`
		$appStore.workspace.openLinkText(linkPath, "", "tab")
	}
</script>

<div bind:this={markdownEl} class={className} onclick={handleLinkClick}></div>
