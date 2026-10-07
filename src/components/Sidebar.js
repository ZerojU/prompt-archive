/**
 * Sidebar navigation component — Task 10.
 *
 * Renders a Display_Name-injected CategoryTree (produced by
 * `manifestLoader.buildDisplayTree`) as a left-hand navigation. The Sidebar
 * does NOT fetch or build the tree itself; it is purely a renderer + a small
 * amount of selection/expansion state.
 *
 * Behavior → Requirements (R4.x):
 *   - R4.1: Render the tree to a MAXIMUM of 2 depth levels (1-depth and
 *           2-depth). Nothing deeper than depth 2 is rendered; a 1-depth node's
 *           children are the only nested level drawn.
 *   - R4.2: Clicking a 1-depth OR 2-depth category shows that folder's
 *           Prompt_File list (the node's `prompts`).
 *   - R4.3: When a category or prompt is selected, exactly ONE item carries the
 *           selected highlight; the previously highlighted item is cleared.
 *           Uses the `is-selected` CSS class and `aria-current`.
 *   - R4.4: A 1-depth category WITHOUT children shows its prompt list directly.
 *   - R4.5: Clicking a 1-depth node that HAS children toggles expand/collapse
 *           of its child category list (`is-expanded` + `aria-expanded`).
 *   - R4.6: A selected category with 0 prompts shows an empty-state message and
 *           keeps the (empty) prompt-list region present.
 *
 * The DOM is built with createElement/textContent (never innerHTML for tree
 * values) using nav/ul/li/button semantics for accessibility.
 *
 * Design reference: design.md "Components and Interfaces → Sidebar
 * (src/components/Sidebar.js)".
 *
 * _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6._
 */

/**
 * @typedef {{title:string, file:string, path:string, displayName?:string}} PromptRef
 * @typedef {{name:string, path:string, displayName?:string, prompts:PromptRef[], children:CategoryNode[]}} CategoryNode
 * @typedef {{version:number, generatedAt?:string, categories:CategoryNode[]}} CategoryTree
 */

const SELECTED_CLASS = 'is-selected';
const EXPANDED_CLASS = 'is-expanded';
const EMPTY_MESSAGE = '프롬프트가 없습니다';

/**
 * The visible label for a node/prompt: prefer `displayName`, fall back to
 * `name` (categories) or `title`/file-derived label (prompts).
 *
 * @param {{displayName?:string, name?:string, title?:string}} node
 * @returns {string}
 */
function labelFor(node) {
  if (node && typeof node.displayName === 'string' && node.displayName !== '') {
    return node.displayName;
  }
  if (node && typeof node.name === 'string' && node.name !== '') {
    return node.name;
  }
  if (node && typeof node.title === 'string' && node.title !== '') {
    return node.title;
  }
  return '';
}

/**
 * Create the Sidebar.
 *
 * @param {HTMLElement} root - Container element to render into (cleared first).
 * @param {CategoryTree} tree - Display tree with `displayName` on nodes.
 * @param {(promptRef: PromptRef) => void} [onSelectPrompt] - Invoked when a
 *   prompt is selected.
 * @returns {{
 *   element: HTMLElement,
 *   selectCategory: (path:string) => void,
 *   getSelectedKey: () => string|null,
 *   destroy: () => void,
 * }}
 */
export function createSidebar(root, tree, onSelectPrompt) {
  if (!root || typeof root.appendChild !== 'function') {
    throw new TypeError('createSidebar: root must be an HTMLElement');
  }
  const doc = root.ownerDocument || document;
  const categories = tree && Array.isArray(tree.categories) ? tree.categories : [];
  const onSelect = typeof onSelectPrompt === 'function' ? onSelectPrompt : () => {};

  // State ------------------------------------------------------------------
  /** @type {Set<string>} paths of expanded 1-depth nodes */
  const expandedPaths = new Set();
  /** @type {string|null} the single currently-highlighted item key */
  let selectedKey = null;
  /** @type {HTMLElement|null} the currently-highlighted element */
  let selectedEl = null;

  // All interactive items keyed for highlight management.
  // category keys are `cat:<path>`; prompt keys are `prompt:<file>`.
  /** @type {Map<string, HTMLElement>} */
  const itemEls = new Map();
  // For each category path, the list region element that holds its prompts.
  /** @type {Map<string, HTMLElement>} */
  const promptRegionEls = new Map();

  // Clear the container.
  while (root.firstChild) root.removeChild(root.firstChild);

  const nav = doc.createElement('nav');
  nav.className = 'sidebar';
  nav.setAttribute('aria-label', '프롬프트 카테고리');

  const rootList = doc.createElement('ul');
  rootList.className = 'sidebar-tree';
  rootList.setAttribute('role', 'tree');
  nav.appendChild(rootList);

  // Build ------------------------------------------------------------------
  for (const category of categories) {
    rootList.appendChild(buildCategoryItem(category, 1));
  }

  root.appendChild(nav);

  /**
   * Highlight a single element, clearing the previously highlighted one (R4.3).
   * @param {string} key
   * @param {HTMLElement} el
   */
  function setSelected(key, el) {
    if (selectedEl && selectedEl !== el) {
      selectedEl.classList.remove(SELECTED_CLASS);
      selectedEl.removeAttribute('aria-current');
    }
    selectedKey = key;
    selectedEl = el;
    el.classList.add(SELECTED_CLASS);
    el.setAttribute('aria-current', 'true');
  }

  /**
   * Render (or clear) a category's prompt list into its region. Always keeps
   * the region element present; shows an empty-state message when there are no
   * prompts (R4.6).
   * @param {CategoryNode} category
   * @param {HTMLElement} region
   */
  function renderPrompts(category, region) {
    while (region.firstChild) region.removeChild(region.firstChild);
    const prompts = Array.isArray(category.prompts) ? category.prompts : [];

    if (prompts.length === 0) {
      const empty = doc.createElement('p');
      empty.className = 'sidebar-empty';
      empty.textContent = EMPTY_MESSAGE;
      region.appendChild(empty);
      region.hidden = false;
      return;
    }

    const list = doc.createElement('ul');
    list.className = 'sidebar-prompts';
    list.setAttribute('role', 'group');

    for (const prompt of prompts) {
      const li = doc.createElement('li');
      li.className = 'sidebar-prompt';
      li.setAttribute('role', 'none');

      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'sidebar-prompt-btn';
      btn.setAttribute('role', 'treeitem');
      btn.textContent = labelFor(prompt);

      const key = `prompt:${prompt.file}`;
      itemEls.set(key, btn);

      btn.addEventListener('click', () => {
        setSelected(key, btn);
        onSelect(prompt);
      });

      li.appendChild(btn);
      list.appendChild(li);
    }
    region.appendChild(list);
    region.hidden = false;
  }

  /**
   * Build a category <li> (1-depth or 2-depth). At depth 2 we never recurse
   * into children, enforcing the max-2 rendering rule (R4.1).
   * @param {CategoryNode} category
   * @param {number} depth - 1 or 2.
   * @returns {HTMLElement}
   */
  function buildCategoryItem(category, depth) {
    const hasChildren =
      depth === 1 && Array.isArray(category.children) && category.children.length > 0;

    const li = doc.createElement('li');
    li.className = `sidebar-category depth-${depth}`;
    li.setAttribute('role', 'none');

    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'sidebar-category-btn';
    btn.setAttribute('role', 'treeitem');
    btn.textContent = labelFor(category);
    const catKey = `cat:${category.path}`;
    itemEls.set(catKey, btn);

    // Region that holds this category's own prompt list.
    const promptRegion = doc.createElement('div');
    promptRegion.className = 'sidebar-prompt-region';
    promptRegion.hidden = true;
    promptRegionEls.set(category.path, promptRegion);

    if (hasChildren) {
      // 1-depth node WITH children: it is an expand/collapse toggle (R4.5) AND
      // selecting it shows its own prompt list (R4.2).
      btn.setAttribute('aria-expanded', 'false');

      const childList = doc.createElement('ul');
      childList.className = 'sidebar-children';
      childList.setAttribute('role', 'group');
      childList.hidden = true;
      for (const child of category.children) {
        // depth 2 — buildCategoryItem won't recurse further (R4.1).
        childList.appendChild(buildCategoryItem(child, 2));
      }

      btn.addEventListener('click', () => {
        // R4.5 + reported bug fix: a 1-depth node WITH children governs
        // EVERYTHING under it (its own prompt region AND its child-category
        // list) as a single expand/collapse unit. `toggleExpand` flips the
        // state and the child list; here we keep the prompt region in sync so
        // that collapsing hides it too (previously it was shown
        // unconditionally and stayed visible on collapse).
        toggleExpand(category, btn, childList);
        const isExpanded = expandedPaths.has(category.path);
        if (isExpanded) {
          // Expanded: show+render the prompt region and highlight the node.
          setSelected(catKey, btn);
          renderPrompts(category, promptRegion);
        } else {
          // Collapsed: nothing under the node remains visible. Clear and hide
          // the prompt region alongside the (already hidden) child list.
          while (promptRegion.firstChild) {
            promptRegion.removeChild(promptRegion.firstChild);
          }
          promptRegion.hidden = true;
        }
      });

      li.appendChild(btn);
      li.appendChild(promptRegion);
      li.appendChild(childList);
    } else {
      // 1-depth WITHOUT children (R4.4) OR a 2-depth node (R4.2): clicking
      // shows the prompt list directly.
      btn.addEventListener('click', () => {
        setSelected(catKey, btn);
        renderPrompts(category, promptRegion);
      });
      li.appendChild(btn);
      li.appendChild(promptRegion);
    }

    return li;
  }

  /**
   * Toggle expand/collapse of a 1-depth node's child list (R4.5).
   * @param {CategoryNode} category
   * @param {HTMLElement} btn
   * @param {HTMLElement} childList
   */
  function toggleExpand(category, btn, childList) {
    const isExpanded = expandedPaths.has(category.path);
    if (isExpanded) {
      expandedPaths.delete(category.path);
      btn.classList.remove(EXPANDED_CLASS);
      btn.setAttribute('aria-expanded', 'false');
      childList.hidden = true;
    } else {
      expandedPaths.add(category.path);
      btn.classList.add(EXPANDED_CLASS);
      btn.setAttribute('aria-expanded', 'true');
      childList.hidden = false;
    }
  }

  return {
    element: nav,
    /**
     * Programmatically select a category by path (shows its prompt list and
     * highlights it). Useful for wiring/tests.
     * @param {string} path
     */
    selectCategory(path) {
      const el = itemEls.get(`cat:${path}`);
      if (el) el.click();
    },
    getSelectedKey() {
      return selectedKey;
    },
    destroy() {
      while (root.firstChild) root.removeChild(root.firstChild);
      itemEls.clear();
      promptRegionEls.clear();
      expandedPaths.clear();
      selectedKey = null;
      selectedEl = null;
    },
  };
}
