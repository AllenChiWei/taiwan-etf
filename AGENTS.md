# AGENTS.md

## Project overview

This workspace contains a single static HTML page, [taiwan_etf_list.html](taiwan_etf_list.html), which renders a searchable Taiwan ETF directory with category sections, custodian-bank filters, dividend-frequency filters, and external MoneyDJ links.

## Working conventions

- Treat this as a lightweight static frontend project. Do not introduce frameworks, build tools, package managers, or bundlers unless the user explicitly asks for them.
- Keep the page self-contained in HTML/CSS/JS. Most changes should happen directly in [taiwan_etf_list.html](taiwan_etf_list.html).
- Preserve the current page structure and user-facing behavior:
  - section IDs such as `cat-domestic`, `cat-foreign`, and `cat-leveraged-futures`
  - the filter-bar controls (`searchBox`, `custodianFilter`, `frequencyFilter`)
  - the `filterRows`, `resetFilters`, and `scrollToTop` functions
  - the `data-custodian` and `data-frequency` attributes on table rows

## Data and content expectations

- ETF rows are stored directly in the HTML table bodies. When adding or editing ETF entries, keep the record consistent with the surrounding structure.
- For row filtering to work correctly, each row should still include:
  - `data-custodian` with the bank name
  - `data-frequency` with one of the existing frequency labels such as `月配`, `雙月配`, `季配`, `半年配`, `年配`, or `—`
- The page is bilingual/Traditional Chinese oriented; keep labels, headings, and placeholders in Traditional Chinese unless the user instructs otherwise.

## Practical guidance for AI agents

- If the user asks to update ETF data, edit the relevant sections and rows in [taiwan_etf_list.html](taiwan_etf_list.html) rather than creating separate data files.
- If a change affects counts, update the visible counts in the section headers and the stats boxes in the page header to stay consistent.
- If you add new filter options or new frequency categories, update both the HTML controls and the JS filtering logic in the same file.
- When changing styling, prefer preserving the current visual layout and CSS class names unless the request clearly requires a redesign.

## Verification

- There is no automated test suite or build step in this workspace.
- After editing, validate by opening [taiwan_etf_list.html](taiwan_etf_list.html) in a browser and checking that:
  1. the page still renders,
  2. filters still work,
  3. links still point to MoneyDJ,
  4. section counts and stats remain accurate.
