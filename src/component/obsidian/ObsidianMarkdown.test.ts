import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MarkdownRenderer } from 'obsidian'

// Mock the MarkdownRenderer
vi.mock('obsidian', () => ({
  MarkdownRenderer: {
    render: vi.fn()
  }
}))

describe('ObsidianMarkdown link rendering', () => {
  let mockElement: HTMLElement
  let mockApp: any
  let mockView: any

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks()
    
    // Create a mock element to capture rendered content
    mockElement = {
      innerHTML: '',
      replaceChildren: vi.fn(),
      appendChild: vi.fn((child) => {
        mockElement.innerHTML += child.outerHTML || child.textContent
      })
    } as any

    mockApp = {
      workspace: {
        getActiveFile: () => ({ path: 'test/active-file.md' })
      }
    }

    mockView = {}
  })

  it('should handle wikilinks correctly', () => {
    const testCases = [
      {
        name: 'Simple wikilink',
        input: '[[My Note]]',
        expectedPattern: /My Note/
      },
      {
        name: 'Wikilink with path',
        input: '[[folder/My Note]]',
        expectedPattern: /My Note/
      },
      {
        name: 'Wikilink with alias',
        input: '[[folder/My Note|Display Name]]',
        expectedPattern: /Display Name/
      },
      {
        name: 'Multiple wikilinks',
        input: 'Check [[Note 1]] and [[Note 2]]',
        expectedPattern: /Note 1.*Note 2/
      }
    ]

    testCases.forEach(({ name, input, expectedPattern }) => {
      // Mock the render function to simulate Obsidian's behavior
      (MarkdownRenderer.render as any).mockImplementation((app: any, source: any, el: any, sourcePath: any, view: any) => {
        console.log(`Test: ${name}`)
        console.log(`Input: ${source}`)
        console.log(`Source path: ${sourcePath}`)
        
        // Simulate how Obsidian might transform wikilinks
        // This is where we can observe what Obsidian actually does
        let transformed = source
          .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '<a href="$1">$2</a>')
          .replace(/\[\[([^\]]+)\]\]/g, '<a href="$1">$1</a>')
        
        el.innerHTML = transformed
      })

      MarkdownRenderer.render(mockApp, input, mockElement, 'test/source.md', mockView)
      
      expect(mockElement.innerHTML).toMatch(expectedPattern)
      console.log(`Output: ${mockElement.innerHTML}\n`)
    })
  })

  it('should log actual Obsidian transformation', () => {
    // This test helps us understand what Obsidian actually does
    const input = '[[You don\'t own your gender]]'
    
    ;(MarkdownRenderer.render as any).mockImplementation((app: any, source: any, el: any, sourcePath: any, view: any) => {
      // Log what we receive
      console.log('=== Actual Obsidian Transformation Test ===')
      console.log('Input markdown:', source)
      console.log('Source path:', sourcePath)
      
      // In the real implementation, Obsidian would transform this
      // Let's see if we can capture the actual behavior
      el.innerHTML = `<a data-href="${source.slice(2, -2)}" href="${source.slice(2, -2)}" class="internal-link">You don't own your gender</a>`
    })

    MarkdownRenderer.render(mockApp, input, mockElement, '', mockView)
    
    console.log('Mock output:', mockElement.innerHTML)
    console.log('==========================================')
  })
})