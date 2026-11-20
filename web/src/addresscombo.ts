// The search field as an ARIA combobox: a text field, the listbox its
// suggestions go into, keyboard navigation (arrows, Enter, Escape) and a
// debounced search. Moved out of main.ts; the shape follows Svampekortet
// 624fb8b (web/src/addresscombo.ts). What is searched, and what the field says
// about it, is placesearch.ts's business: this file knows only items.

/** One suggestion. */
export interface ComboItem {
  /** The name: shown first, and what the field and the pin are called. */
  text: string;
  /** A quieter second line: what it is and where ("Badested · 4640 Faxe"). */
  meta?: string;
  /** Static markup put in front of the text (an icon). */
  icon?: string;
  /** For styling: "town", "postal", "coast", "address". */
  kind: string;
  target: [number, number];
  zoom?: number;
}

/** What became of the last search, for a caller that tells the user. */
export type SearchOutcome<S extends string = string> = { state: S; query: string; shown: number };

/** Lists what is typed. `show` may be called more than once (places at once,
 * addresses when they come); `note` is a line put above the first address.
 * Resolves to what became of the search. */
export type SearchFn<S extends string> = (
  query: string,
  signal: AbortSignal,
  show: (items: ComboItem[], note?: string) => void,
) => Promise<S>;

export interface Combobox {
  /** Search again for what is in the field now (a "Prøv igen"). */
  refresh(): void;
  /** Close the suggestions and drop any search still on its way. */
  close(): void;
}

/** Pure: the next option to highlight, wrapping at both ends; -1 with none. */
export function step(current: number, by: number, count: number): number {
  if (count === 0) return -1;
  if (current < 0) return by > 0 ? 0 : count - 1;
  return (current + by + count) % count;
}

export function attachCombobox<S extends string>(opts: {
  input: HTMLInputElement;
  /** Must carry an id; the input names it in aria-controls. */
  listbox: HTMLUListElement;
  search: SearchFn<S>;
  /** A suggestion was chosen. */
  onSelect: (item: ComboItem) => void;
  /** Told after every search, and with state "chosen" when one is picked. */
  onOutcome?: (outcome: SearchOutcome<S | "chosen">) => void;
  /** Enter with nothing highlighted takes the first suggestion. */
  enterPicksFirst?: boolean;
}): Combobox {
  const { input, listbox } = opts;
  let debounce: number | undefined;
  let inFlight: AbortController | null = null;
  let items: ComboItem[] = [];
  let activeIndex = -1;

  function closeResults(): void {
    listbox.replaceChildren();
    items = [];
    activeIndex = -1;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }

  function select(item: ComboItem | undefined): void {
    if (!item) return;
    window.clearTimeout(debounce);
    inFlight?.abort();
    input.value = item.text;
    closeResults();
    opts.onOutcome?.({ state: "chosen", query: item.text, shown: 0 });
    opts.onSelect(item);
  }

  function highlight(next: number): void {
    const options = [...listbox.querySelectorAll<HTMLLIElement>('[role="option"]')];
    activeIndex = next;
    options.forEach((li, i) => {
      const on = i === activeIndex;
      li.classList.toggle("is-active", on);
      li.setAttribute("aria-selected", String(on));
      if (on) {
        input.setAttribute("aria-activedescendant", li.id);
        li.scrollIntoView({ block: "nearest" });
      }
    });
  }

  function render(next: ComboItem[], note?: string): void {
    items = next;
    activeIndex = -1;
    input.removeAttribute("aria-activedescendant");
    listbox.replaceChildren();
    const noteId = `${listbox.id}-note`;
    let noted = false;
    items.forEach((item, i) => {
      if (note && item.kind === "address" && !noted) {
        noted = true;
        // not an option: hidden from the listbox's own reading, and given to
        // each address as its description instead
        const line = document.createElement("li");
        line.id = noteId;
        line.className = "results-note";
        line.setAttribute("aria-hidden", "true");
        line.textContent = note;
        listbox.appendChild(line);
      }
      const li = document.createElement("li");
      li.id = `${listbox.id}-opt-${i}`;
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", "false");
      li.dataset.kind = item.kind;
      if (item.icon) li.insertAdjacentHTML("afterbegin", item.icon); // static markup
      const body = document.createElement("span");
      body.className = "opt-body";
      const name = document.createElement("span");
      name.className = "opt-name";
      name.textContent = item.text;
      body.append(name);
      if (item.meta) {
        const meta = document.createElement("span");
        meta.className = "opt-meta";
        // a comma for screen readers between name and the second line
        meta.textContent = item.meta;
        name.append(
          Object.assign(document.createElement("span"), {
            className: "sr-only",
            textContent: ", ",
          }),
        );
        body.append(meta);
      }
      li.append(body);
      if (note && item.kind === "address") li.setAttribute("aria-describedby", noteId);
      li.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus on the input
      li.addEventListener("click", () => select(item));
      listbox.appendChild(li);
    });
    input.setAttribute("aria-expanded", String(items.length > 0));
  }

  async function runSearch(): Promise<void> {
    inFlight?.abort();
    const request = new AbortController();
    inFlight = request;
    const query = input.value.trim();
    let shown = 0;
    let state: S;
    try {
      state = await opts.search(query, request.signal, (next, note) => {
        if (request.signal.aborted) return;
        shown = next.length;
        render(next, note);
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      throw err;
    }
    if (request.signal.aborted) return; // a newer search has taken over
    if (shown === 0) closeResults();
    opts.onOutcome?.({ state, query, shown });
  }

  input.addEventListener("input", () => {
    window.clearTimeout(debounce);
    // An emptied field answers at once; typing waits for a pause.
    debounce = window.setTimeout(() => void runSearch(), input.value.trim() ? 200 : 0);
  });

  input.addEventListener("keydown", (e) => {
    const count = items.length;
    if (e.key === "ArrowDown" && count > 0) {
      e.preventDefault();
      highlight(step(activeIndex, 1, count));
    } else if (e.key === "ArrowUp" && count > 0) {
      e.preventDefault();
      highlight(step(activeIndex, -1, count));
    } else if (e.key === "Enter") {
      // never submit the form (it would reload the page)
      e.preventDefault();
      if (activeIndex >= 0) select(items[activeIndex]);
      else if (opts.enterPicksFirst && count > 0) select(items[0]);
    } else if (e.key === "Escape" && count > 0) {
      // Escape closes the suggestions first; only the next one reaches
      // whatever the field sits in (or clears the field, as a search field does).
      e.preventDefault();
      e.stopPropagation();
      closeResults();
    }
  });

  input.addEventListener("blur", () => window.setTimeout(closeResults, 150));

  return {
    refresh(): void {
      window.clearTimeout(debounce);
      void runSearch();
    },
    close(): void {
      window.clearTimeout(debounce);
      inFlight?.abort();
      closeResults();
    },
  };
}
