import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createSidebar } from '../src/components/Sidebar.js';

/**
 * jsdom unit tests for the Sidebar component (Task 10.2).
 *
 * Covers:
 *   - 2-depth structural rendering with displayName labels; nothing deeper than
 *     depth 2 (R4.1).
 *   - Clicking a category shows its prompts; clicking a prompt invokes
 *     onSelectPrompt with the right PromptRef (R4.2).
 *   - Single-selection highlight transitions — selecting B clears A (R4.3).
 *   - Expand/collapse toggle on a 1-depth node with children (R4.5).
 *   - 1-depth node without children shows its prompts directly (R4.4).
 *   - Empty category shows the empty-state message and keeps the list region
 *     (R4.6).
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
 */

/** Build a sample Display_Name-injected CategoryTree. */
function sampleTree() {
  return {
    version: 1,
    categories: [
      {
        // 1-depth WITH a 2-depth child (toggle case, R4.5).
        name: 'backend',
        path: 'backend',
        displayName: '백엔드',
        prompts: [
          { title: 'Spring Boot', file: 'prompts/backend/spring.html', path: 'backend', displayName: '스프링 부트' },
        ],
        children: [
          {
            name: 'database',
            path: 'backend/database',
            displayName: '데이터베이스',
            prompts: [
              { title: 'PostgreSQL', file: 'prompts/backend/database/pg.html', path: 'backend/database', displayName: 'PostgreSQL 튜닝' },
            ],
            children: [],
          },
        ],
      },
      {
        // 1-depth WITHOUT children (direct prompt list, R4.4).
        name: 'frontend',
        path: 'frontend',
        displayName: '프런트엔드',
        prompts: [
          { title: 'React', file: 'prompts/frontend/react.html', path: 'frontend', displayName: 'React Hooks' },
        ],
        children: [],
      },
      {
        // 1-depth WITHOUT children and WITHOUT prompts (empty state, R4.6).
        name: 'empty',
        path: 'empty',
        displayName: '빈 카테고리',
        prompts: [],
        children: [],
      },
    ],
  };
}

let root;

beforeEach(() => {
  document.body.innerHTML = '';
  root = document.createElement('div');
  document.body.appendChild(root);
});

/** Find a category button by its visible label. */
function categoryBtn(label) {
  return [...root.querySelectorAll('.sidebar-category-btn')].find(
    (b) => b.textContent === label,
  );
}

describe('createSidebar — rendering (R4.1)', () => {
  it('renders 1-depth and 2-depth categories with their displayName labels', () => {
    createSidebar(root, sampleTree(), () => {});

    const catLabels = [...root.querySelectorAll('.sidebar-category-btn')].map(
      (b) => b.textContent,
    );
    expect(catLabels).toContain('백엔드'); // 1-depth
    expect(catLabels).toContain('프런트엔드'); // 1-depth
    expect(catLabels).toContain('빈 카테고리'); // 1-depth
    expect(catLabels).toContain('데이터베이스'); // 2-depth, under backend
  });

  it('does not render anything deeper than depth 2', () => {
    createSidebar(root, sampleTree(), () => {});
    // Only depth-1 and depth-2 classes exist; no depth-3.
    expect(root.querySelector('.depth-1')).toBeTruthy();
    expect(root.querySelector('.depth-2')).toBeTruthy();
    expect(root.querySelector('.depth-3')).toBeNull();
    // The 2-depth node sits inside the 1-depth node's children list.
    const backendLi = categoryBtn('백엔드').closest('.sidebar-category');
    expect(backendLi.querySelector('.sidebar-children .depth-2')).toBeTruthy();
  });

  it('uses name as a fallback when displayName is missing', () => {
    const tree = {
      version: 1,
      categories: [{ name: 'raw', path: 'raw', prompts: [], children: [] }],
    };
    createSidebar(root, tree, () => {});
    expect(categoryBtn('raw')).toBeTruthy();
  });
});

describe('createSidebar — category/prompt selection (R4.2)', () => {
  it('clicking a 2-depth category shows its prompts, clicking a prompt calls onSelectPrompt', () => {
    const onSelect = vi.fn();
    const sidebar = createSidebar(root, sampleTree(), onSelect);

    // Expand backend so the database child is visible, then click database.
    categoryBtn('백엔드').click();
    const dbBtn = categoryBtn('데이터베이스');
    dbBtn.click();

    const promptBtns = dbBtn
      .closest('.sidebar-category')
      .querySelectorAll('.sidebar-prompt-btn');
    const pg = [...promptBtns].find((b) => b.textContent === 'PostgreSQL 튜닝');
    expect(pg).toBeTruthy();

    pg.click();
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ file: 'prompts/backend/database/pg.html', path: 'backend/database' }),
    );
    expect(sidebar.getSelectedKey()).toBe('prompt:prompts/backend/database/pg.html');
  });
});

describe('createSidebar — single-selection highlight transitions (R4.3)', () => {
  it('selecting item B clears A so only one is-selected exists', () => {
    createSidebar(root, sampleTree(), () => {});

    // Select frontend (direct prompts), then its prompt.
    categoryBtn('프런트엔드').click();
    expect(root.querySelectorAll('.is-selected')).toHaveLength(1);
    expect(categoryBtn('프런트엔드').classList.contains('is-selected')).toBe(true);

    const reactBtn = [...root.querySelectorAll('.sidebar-prompt-btn')].find(
      (b) => b.textContent === 'React Hooks',
    );
    reactBtn.click();

    // Only one highlighted item, and it transitioned to the prompt.
    expect(root.querySelectorAll('.is-selected')).toHaveLength(1);
    expect(reactBtn.classList.contains('is-selected')).toBe(true);
    expect(categoryBtn('프런트엔드').classList.contains('is-selected')).toBe(false);
    // aria-current cleared on the previously-selected item.
    expect(categoryBtn('프런트엔드').hasAttribute('aria-current')).toBe(false);
    expect(reactBtn.getAttribute('aria-current')).toBe('true');
  });
});

describe('createSidebar — expand/collapse toggle (R4.5)', () => {
  it('first click on a 1-depth node with children expands, second collapses', () => {
    createSidebar(root, sampleTree(), () => {});
    const backend = categoryBtn('백엔드');
    const backendLi = backend.closest('.sidebar-category');
    const childList = backendLi.querySelector('.sidebar-children');
    const region = backendLi.querySelector('.sidebar-prompt-region');

    // Initially collapsed: BOTH the child list and the prompt region hidden.
    expect(childList.hidden).toBe(true);
    expect(region.hidden).toBe(true);
    expect(backend.getAttribute('aria-expanded')).toBe('false');

    // First click expands: BOTH the child list and the prompt region show.
    backend.click();
    expect(childList.hidden).toBe(false);
    expect(region.hidden).toBe(false);
    expect(backend.getAttribute('aria-expanded')).toBe('true');
    expect(backend.classList.contains('is-expanded')).toBe(true);

    // Second click collapses: BOTH hide again.
    backend.click();
    expect(childList.hidden).toBe(true);
    expect(region.hidden).toBe(true);
    expect(backend.getAttribute('aria-expanded')).toBe('false');
    expect(backend.classList.contains('is-expanded')).toBe(false);
  });

  it('collapsing a 1-depth node with children hides EVERYTHING under it (reported bug)', () => {
    createSidebar(root, sampleTree(), () => {});
    const backend = categoryBtn('백엔드');
    const backendLi = backend.closest('.sidebar-category');
    const childList = backendLi.querySelector('.sidebar-children');
    const region = backendLi.querySelector('.sidebar-prompt-region');

    // Expand: the node's own prompt list AND its child-category list are shown.
    backend.click();
    expect(region.hidden).toBe(false);
    expect(childList.hidden).toBe(false);
    // Its own prompt (스프링 부트) is rendered in the region.
    expect(region.querySelectorAll('.sidebar-prompt-btn')).toHaveLength(1);
    expect(region.querySelector('.sidebar-prompt-btn').textContent).toBe('스프링 부트');

    // Collapse: nothing under the node remains visible — the child list AND the
    // prompt region are both hidden (previously the region stayed visible).
    backend.click();
    expect(childList.hidden).toBe(true);
    expect(region.hidden).toBe(true);
    // aria-expanded/is-expanded stay in sync with actual visibility.
    expect(backend.getAttribute('aria-expanded')).toBe('false');
    expect(backend.classList.contains('is-expanded')).toBe(false);
    // The highlight remains on the category button itself (R4.3 single select).
    expect(backend.classList.contains('is-selected')).toBe(true);
    expect(root.querySelectorAll('.is-selected')).toHaveLength(1);
  });
});

describe('createSidebar — 1-depth without children (R4.4)', () => {
  it('shows the prompt list directly on click', () => {
    const onSelect = vi.fn();
    createSidebar(root, sampleTree(), onSelect);

    const frontend = categoryBtn('프런트엔드');
    frontend.click();

    const region = frontend
      .closest('.sidebar-category')
      .querySelector('.sidebar-prompt-region');
    expect(region.hidden).toBe(false);
    const prompts = region.querySelectorAll('.sidebar-prompt-btn');
    expect(prompts).toHaveLength(1);
    expect(prompts[0].textContent).toBe('React Hooks');
  });
});

describe('createSidebar — empty category (R4.6)', () => {
  it('shows the empty-state message and keeps the list region present', () => {
    createSidebar(root, sampleTree(), () => {});

    const empty = categoryBtn('빈 카테고리');
    empty.click();

    const region = empty
      .closest('.sidebar-category')
      .querySelector('.sidebar-prompt-region');
    expect(region).toBeTruthy();
    expect(region.hidden).toBe(false);
    const msg = region.querySelector('.sidebar-empty');
    expect(msg).toBeTruthy();
    expect(msg.textContent).toBe('프롬프트가 없습니다');
    // No prompt buttons rendered.
    expect(region.querySelectorAll('.sidebar-prompt-btn')).toHaveLength(0);
  });
});

describe('createSidebar — API', () => {
  it('selectCategory highlights the category and destroy clears the DOM', () => {
    const sidebar = createSidebar(root, sampleTree(), () => {});
    sidebar.selectCategory('frontend');
    expect(sidebar.getSelectedKey()).toBe('cat:frontend');
    expect(root.querySelectorAll('.is-selected')).toHaveLength(1);

    sidebar.destroy();
    expect(root.children).toHaveLength(0);
    expect(sidebar.getSelectedKey()).toBeNull();
  });
});
