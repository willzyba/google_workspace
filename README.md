# CodeCogs Equation Editor for Google Docs & Slides

A Google Workspace **editor add-on** (Apps Script, not an npm package - Docs and Slides have
no plugin system to load one into) that adds an **Insert equation...** item to the Add-ons
menu in both Docs and Slides, opening a sidebar with the same Equation Editor UI every other
adapter in this repo embeds.

**This has not been deployed or run against a real Google account** - there is no Google Cloud
project or Apps Script project behind this repo to test it in. The code follows Google's
documented Apps Script / editor add-on APIs as closely as current knowledge of them allows, and
has been checked for JavaScript syntax errors, but every step below needs to actually be done,
and the result clicked through, before this is a real add-on anyone can install.

## Why this is a sidebar, not a toolbar button

Docs and Slides expose no API for a third party to add a button to their own toolbar - the
only UI surface an editor add-on gets is an Add-ons menu item and, from it, a sidebar
(`HtmlService`) or a dialog. A menu item opening a sidebar is the standard shape for this kind
of add-on.

## Why this only inserts as an image

Unlike the CKEditor 5, TinyMCE, Froala and Tiptap adapters, there is no `insertAs` option here.
Docs and Slides have no native LaTeX or MathML object for Apps Script to write into - `'latex'`
mode would just leave inert `$$...$$` text sitting in the document, since neither app runs
anything like fxTeX to convert it; `'mathml'` mode has no representation at all in the Docs/
Slides object model. An inserted image is the only form that reliably means something in either
app, so it is the only form this add-on offers.

## Structure

```
appsscript.json      Manifest - OAuth scopes, Docs/Slides add-on registration.
src/Code.gs           Server-side: menu registration, the sidebar, and the insert itself.
src/Sidebar.html      The sidebar UI - the full EqEditor UI, loaded the same way every other
                      adapter loads it (see below), plus an Insert button.
```

## How the insert actually happens

1. The sidebar (running in Apps Script's sandboxed iframe) loads `eqneditor.api.min.js` and
   `eqneditor.css` from `editor.codecogs.com` exactly the way the other adapters do, and
   builds the same `EqEditor.TextArea`/`Toolbar`/`MathView`/`Output` set.
2. Pressing **Insert** reads the current equation via `Output.exportAs('url')` - the exact
   same call the other adapters use, so this add-on never re-derives or re-escapes a rendering
   URL itself - and calls `google.script.run.insertEquation(url)`.
3. `insertEquation()` runs **server-side** (on Google's servers, not in the sidebar), fetches
   the rendered PNG with `UrlFetchApp`, and inserts it at the cursor (Docs) or onto the current
   slide (Slides).

Fetching server-side rather than asking the sidebar to upload image bytes means the rendering
service only ever needs to be reachable from Google's servers, not from inside the sidebar's
sandboxed iframe.

## Deploying

This needs a Google Cloud project and [`clasp`](https://github.com/google/clasp), Google's own
Apps Script CLI - neither exists yet for this add-on.

```
npm install -g @google/clasp
clasp login
clasp create --type docs --title "CodeCogs Equation Editor" --rootDir src
clasp push
```

(`--type docs` scaffolds a Docs-bound project; the manifest's own `addOns.slides` section is
what actually makes it install into Slides too - `--type` only affects clasp's own scaffold.)

Then, from the Apps Script editor:

1. *Deploy &rarr; Test deployments* to try it in your own Docs/Slides before publishing.
2. *Deploy &rarr; New deployment &rarr; Editor Add-on* once it is working, which requires the
   Cloud project it runs under to complete Google's OAuth verification before anyone outside
   your own organisation can install it - the `oauthScopes` in `appsscript.json` are broad
   enough (`documents.currentonly`, `presentations.currentonly`) that this will need it.
3. To publish it to the Google Workspace Marketplace for anyone to find, list it from
   *Deploy &rarr; New deployment*, which needs a Marketplace SDK configuration and store
   listing that do not exist yet either.

## Configuration

`Code.gs`'s `getConfig()` reads two [Script
Properties](https://developers.google.com/apps-script/guides/properties), falling back to the
same defaults every other adapter uses if neither is set:

| Script Property | Default | Meaning |
|---|---|---|
| `EQNEDITOR_SERVER` | `editor.codecogs.com` | Host the Equation Editor's own code is loaded from. |
| `EQNEDITOR_RENDER_URL` | `https://latex.codecogs.com` | The rendering service. |

## Known gaps

- **Undeployed and untested** - see above.
- **No automated tests.** Apps Script has its own testing story (`clasp run` against a test
  deployment, or a mocking library for the DocumentApp/SlidesApp/UrlFetchApp globals); neither
  exists yet.
- **No Slides "current slide" fallback verified.** `insertEquation()` falls back to the first
  slide if nothing is selected - reasonable in principle, but not exercised against a real
  Slides selection.
- **No OAuth verification.** Until Google completes review of the Cloud project this runs
  under, the add-on can only be installed by the developer's own account or a testing group
  added in the Cloud Console, not published for anyone to find.
