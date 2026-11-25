/**
 * LaTeX Equation Editor - fxEditor: the Google Docs & Slides add-on, server side.
 *
 * A "classic" editor add-on (not a Card-based Workspace Add-on): one menu item opens a
 * sidebar (Sidebar.html) containing the full Equation Editor UI, the same one every other
 * fxPlugins adapter embeds. The sidebar itself only builds an equation; inserting
 * it into the document happens here, server-side, because DocumentApp/SlidesApp are only
 * available in Apps Script's server context, not in the sandboxed sidebar iframe.
 *
 * Docs and Slides have no native LaTeX or MathML object, so - unlike the other adapters in
 * this repo - there is only one insertAs form here: a rendered image. See the README for
 * why 'latex' and 'mathml' modes are not offered.
 */

var DEFAULT_SERVER = 'https://fxtex.codecogs.com';
var DEFAULT_RENDER_URL = 'https://fxtex.codecogs.com';

/** One add-on menu item, wired to whichever host (Docs or Slides) is running it. */
function onOpen(e) {
    getUi_()
        .createAddonMenu()
        .addItem('Insert equation...', 'showSidebar')
        // The same sidebar: it opens the equation selected in the document (getSelectedEquation()).
        .addItem('Edit selected equation', 'showSidebar')
        .addToUi();
}

function onInstall(e) {
    onOpen(e);
}

// Google fixes a sidebar's width at 300px (setWidth() is ignored), so the sidebar fits its toolbar to
// that, and opens what needs more room - the equation editor at full size (its Larger button), and
// the picture and chemical structure editors - in a window over the document: a modeless dialog,
// which leaves the document usable and its cursor where it was.
function showSidebar() {
    var html = HtmlService.createHtmlOutputFromFile('Sidebar')
        .setTitle('LaTeX Equation Editor');
    getUi_().showSidebar(html);
}

var WINDOWS = {
    equation: {title: 'LaTeX Equation Editor', width: 840, height: 660},
    picture: {title: 'Picture editor', width: 1000, height: 700},
    chemfig: {title: 'Chemical structure editor', width: 1000, height: 700}
};
var WINDOW_SECONDS = 6 * 60 * 60;   // how long a window's request and answer are kept: CacheService's most

/**
 * Opens a window over the document for the sidebar - see WINDOWS - with what it is to open on:
 * {latex} for the equation editor; {latex, setup, saveLabel, explicitUnits} for the picture and
 * chemical structure editors. The window is Sidebar.html again, told which it is by FX_PAGE.
 * Google shows one dialog at a time, so this replaces any window already open.
 *
 * The sidebar and the window are separate frames, which Apps Script gives no way to talk to each
 * other, so the request and its answer go through the user's cache: the window reads the one
 * (getEditorWindow) and leaves the other (finishEditorWindow), which the sidebar asks for until it
 * is there (editorWindowResult).
 *
 * @param {string} kind 'equation', 'picture' or 'chemfig'.
 * @param {Object} request What the window opens on.
 * @returns {string} The window's id, for the sidebar to ask for its answer by.
 */
function openEditorWindow(kind, request) {
    var shape = WINDOWS[kind];
    if (!shape) throw new Error('No such editor: ' + kind);
    var id = Utilities.getUuid();
    CacheService.getUserCache().put('request:' + id, JSON.stringify(request || {}), WINDOW_SECONDS);
    var html = HtmlService.createHtmlOutputFromFile('Sidebar').getContent()
        .replace('<head>', '<head><script>var FX_PAGE = ' + JSON.stringify({mode: kind, id: id}) + ';' +
            // A window only for the picture or chemical structure editor shows none of the equation
            // editor, from the start: it is marked before anything is drawn - see .cc-figure-only.
            (kind === 'equation' ? '' : 'document.documentElement.className = "cc-figure-only";') + '</script>');
    getUi_().showModelessDialog(
        HtmlService.createHtmlOutput(html).setWidth(shape.width).setHeight(shape.height), shape.title);
    return id;
}

/** What the window `id` is to open on - see openEditorWindow(). */
function getEditorWindow(id) {
    var request = CacheService.getUserCache().get('request:' + id);
    return request ? JSON.parse(request) : {};
}

/** The window's answer: the LaTeX, or null when it was cancelled. */
function finishEditorWindow(id, result) {
    CacheService.getUserCache().put('answer:' + id, JSON.stringify({result: result == null ? null : String(result)}), WINDOW_SECONDS);
}

/** The window's answer, {result}, once there is one - taken, so it is given only once - else null. */
function editorWindowResult(id) {
    var cache = CacheService.getUserCache();
    var answer = cache.get('answer:' + id);
    if (!answer) return null;
    cache.removeAll(['request:' + id, 'answer:' + id]);
    return JSON.parse(answer);
}

/**
 * Both DocumentApp and SlidesApp exist as globals in every Apps Script execution regardless
 * of which host the add-on is actually bound to; calling the one that does not match the
 * current container throws. Try/catch is the documented way to tell them apart in a script
 * meant to run as an add-on in more than one host - see
 * https://developers.google.com/apps-script/add-ons/concepts/addon-development#editor_add-ons.
 */
function getUi_() {
    try {
        return DocumentApp.getUi();
    } catch (docErr) {
        try {
            return SlidesApp.getUi();
        } catch (slidesErr) {
            throw new Error( 'LaTeX Equation Editor: not running inside Docs or Slides.' );
        }
    }
}

// EQNEDITOR_DESIGN is JSON; anything that does not parse is treated as no design at all, so a
// typo leaves the standard editor rather than a broken one.
function parseDesign( json ) {
    try {
        return JSON.parse( json || '{}' ) || {};
    } catch ( e ) {
        return {};
    }
}

/** Site-wide config, read by Sidebar.html on load. Script Properties override the defaults - see README. */
function getConfig() {
    var props = PropertiesService.getScriptProperties();
    // The reader's own key, from the sidebar's Settings (saveLicence()), before the add-on's.
    var own = PropertiesService.getUserProperties().getProperty( LICENCE_PROPERTY ) || '';
    var addOn = props.getProperty( LICENCE_PROPERTY ) || '';
    return {
        server: props.getProperty( 'EQNEDITOR_SERVER' ) || DEFAULT_SERVER,
        renderUrl: props.getProperty( 'EQNEDITOR_RENDER_URL' ) || DEFAULT_RENDER_URL,
        // Passed straight to EqEditor.init() - an empty licence is the normal, expected state
        // until a real one is configured, not a required property.
        licence: own || addOn,
        // Whose it is: 'own', 'add-on', or '' for none. Settings shows the reader their own key,
        // never the add-on's.
        licenceFrom: own ? 'own' : addOn ? 'add-on' : '',
        // How the editor looks, as JSON - see the `design` option in the README.
        design: parseDesign( props.getProperty( 'EQNEDITOR_DESIGN' ) )
    };
}

// The licence key: the Script property of this name, set by whoever deploys the add-on, or the
// reader's own, in their User properties under the same name - kept with their Google account, for
// them alone, in every document - which they enter in the sidebar's Settings.
var LICENCE_PROPERTY = 'EQNEDITOR_LICENCE';

/** Saves the reader's own licence key, or removes it when `key` is empty; then reopens the sidebar,
 *  since fxTeX Pro is unlocked once, as the editor loads. */
function saveLicence(key) {
    key = String( key || '' ).trim();
    if ( key && !/^[A-Za-z0-9_-]{6,100}$/.test( key ) ) {
        throw new Error( 'That is not a licence key: they look like fx_pk_ followed by letters and numbers.' );
    }
    var props = PropertiesService.getUserProperties();
    if ( key ) props.setProperty( LICENCE_PROPERTY, key );
    else props.deleteProperty( LICENCE_PROPERTY );
    showSidebar();
}

/**
 * Fetches the rendered equation as a PNG and inserts it at the current cursor (Docs) or onto the
 * current slide (Slides) - or, with `update`, in place of the equation selected in the document
 * (see getSelectedEquation()). Fetching server-side, rather than asking the sidebar to upload image
 * bytes it fetched itself, means the render URL never needs to be reachable from the sidebar's
 * sandboxed iframe - only from Google's own servers, which is where UrlFetchApp actually runs.
 *
 * The URL itself is built client-side, by EqEditor's own Output.getEquationURL(), rather than
 * re-derived here from raw LaTeX: CodeCogs' own query-escaping for spaces/plus/hash is
 * EqEditor's to get right, not this add-on's to guess at a second time.
 *
 * A PNG, because Docs and Slides take only raster images (PNG, JPEG, GIF): an SVG is refused,
 * and neither has a MathML or LaTeX object to write into. It is inserted at 96/dpi of its pixel
 * size, `dpi` being what a normal-size equation is rendered at - three times screen resolution,
 * so it is sharp zoomed in or printed. The sidebar renders a larger or smaller one (its Size) at
 * a proportionally higher or lower resolution, which comes out that much larger or smaller here.
 *
 * Its LaTeX goes in the image's alt text (description), for screen readers, and its alt title
 * marks it as an fxEditor equation, with how it was set - see titleOf_() - so that selecting it
 * later opens it in the editor again.
 *
 * @param {string} url The full rendering URL, from EqEditor's Output.getEquationURL().
 * @param {string} latex The equation's LaTeX, for the alt text.
 * @param {number} dpi What a normal-size equation is rendered at - EQUATION_DPI in Sidebar.html.
 * @param {Object} style {size, fg, bg, inline}: how it is set, kept in its alt title.
 * @param {boolean} update Replace the selected equation rather than insert a new one.
 * @returns {{ok: boolean, message: string, key: (string|undefined)}}
 */
function insertEquation(url, latex, dpi, style, update) {
    if (!url) {
        return {ok: false, message: 'No equation to insert.'};
    }

    var response;
    try {
        response = UrlFetchApp.fetch(url, {muteHttpExceptions: true});
    } catch (fetchErr) {
        return {ok: false, message: 'Could not reach the rendering service: ' + fetchErr.message};
    }

    if (response.getResponseCode() !== 200) {
        return {ok: false, message: 'The rendering service returned an error for this equation.'};
    }

    var blob = response.getBlob().setName('equation.png');
    var scale = Number(dpi) > 96 ? 96 / Number(dpi) : 1;
    var title = titleOf_(style);
    function fit(image) {
        image.setWidth(Math.max(1, Math.round(image.getWidth() * scale)));
        image.setHeight(Math.max(1, Math.round(image.getHeight() * scale)));
    }
    function done(message) {
        return {ok: true, message: message, key: title + '\n' + (latex || '')};
    }

    // Both DocumentApp and SlidesApp are defined in every run (see getUi_()), so which host
    // this is comes from which of them has an active file: the other returns null or throws.
    var doc = active_(function () { return DocumentApp.getActiveDocument(); });
    var presentation = doc ? null : active_(function () { return SlidesApp.getActivePresentation(); });

    var old = null;
    if (update) {
        old = selectedEquation_(doc, presentation);
        if (!old) {
            return {ok: false, message: 'Select the equation to update: click it in the document.'};
        }
    }

    try {
        if (doc) {
            var image;
            if (old) {
                // In the old one's place in its paragraph, which is then selected again.
                var parent = old.getParent();
                image = parent.insertInlineImage(parent.getChildIndex(old), blob);
                old.removeFromParent();
            } else {
                var cursor = doc.getCursor();
                var picked = cursor ? null : selectedImage_(doc);
                // At the cursor; just after an image that is selected instead; else at the end.
                image = cursor ? cursor.insertInlineImage(blob)
                    : picked ? picked.getParent().insertInlineImage(picked.getParent().getChildIndex(picked) + 1, blob)
                    : doc.getBody().appendImage(blob);
            }
            if (!image) {
                return {ok: false, message: 'An equation cannot go there - put the cursor in some text.'};
            }
            fit(image);
            image.setAltTitle(title);
            if (latex) image.setAltDescription(latex);
            if (old) {
                try { doc.setSelection(doc.newRange().addElement(image).build()); } catch (e) {}
            }
            return done(old ? 'Equation updated.' : 'Equation inserted.');
        }

        if (presentation) {
            var picture;
            if (old) {
                // On the same slide, from the same top-left corner.
                picture = old.getParentPage().insertImage(blob);
                fit(picture);
                picture.setLeft(old.getLeft()).setTop(old.getTop());
                old.remove();
            } else {
                // The slide being shown; the first slide if nothing is selected.
                var selection = presentation.getSelection();
                var slide = (selection && selection.getCurrentPage()) || presentation.getSlides()[0];
                if (!slide) {
                    return {ok: false, message: 'Add a slide first, then insert the equation.'};
                }
                picture = slide.insertImage(blob);
                fit(picture);
            }
            picture.setTitle(title);
            if (latex) picture.setDescription(latex);
            if (old) {
                try { picture.select(); } catch (e) {}
            }
            return done(old ? 'Equation updated.' : 'Equation inserted.');
        }
    } catch (insertErr) {
        return {ok: false, message: 'Could not insert the equation: ' + insertErr.message};
    }

    return {ok: false, message: 'Not running inside Docs or Slides.'};
}

// ---- Editing an equation already in the document ------------------------------------------
// Docs and Slides tell an add-on nothing when the reader clicks in the document, and have no
// right-click menu it can add to. But clicking an image selects it, and the sidebar asks what is
// selected every second or two (getSelectedEquation()): an equation put in by this add-on opens
// in the editor, and Insert becomes Update.

var EQUATION_TITLE = 'fxEditor equation';

/** The alt title an equation is given: what it is, and how it was set, e.g.
 *  "fxEditor equation; 14pt; colour #c00000; inline". */
function titleOf_(style) {
    style = style || {};
    var parts = [EQUATION_TITLE];
    if (Number(style.size) > 0) parts.push(Math.round(Number(style.size)) + 'pt');
    if (/^#[0-9a-f]{6}$/i.test(style.fg || '') && style.fg.toLowerCase() !== '#000000') parts.push('colour ' + style.fg);
    if (/^#[0-9a-f]{6}$/i.test(style.bg || '')) parts.push('background ' + style.bg);
    if (style.inline) parts.push('inline');
    return parts.join('; ');
}

/** How an equation was set, from its alt title - see titleOf_(). */
function styleOf_(title) {
    var style = {size: 0, fg: '', bg: '', inline: false};
    String(title || '').split(/;\s*/).slice(1).forEach(function (part) {
        var m;
        if ((m = /^(\d+)pt$/.exec(part))) style.size = Number(m[1]);
        else if ((m = /^colour (#[0-9a-f]{6})$/i.exec(part))) style.fg = m[1];
        else if ((m = /^background (#[0-9a-f]{6})$/i.exec(part))) style.bg = m[1];
        else if (part === 'inline') style.inline = true;
    });
    return style;
}

/** The one inline image selected in the document, if that is what is selected. */
function selectedImage_(doc) {
    var selection = doc.getSelection();
    var parts = selection ? selection.getRangeElements() : [];
    if (parts.length !== 1) return null;
    var element = parts[0].getElement();
    return element.getType() === DocumentApp.ElementType.INLINE_IMAGE ? element.asInlineImage() : null;
}

/** The equation selected in the document or presentation - one image, its alt title marking it as
 *  put in by this add-on (images from before that are left alone) - or null. */
function selectedEquation_(doc, presentation) {
    var image = null, title = '';
    if (doc) {
        image = selectedImage_(doc);
        title = image ? image.getAltTitle() : '';
    } else if (presentation) {
        var selection = presentation.getSelection();
        if (selection && selection.getSelectionType() === SlidesApp.SelectionType.PAGE_ELEMENT) {
            var elements = selection.getPageElementRange().getPageElements();
            if (elements.length === 1 && elements[0].getPageElementType() === SlidesApp.PageElementType.IMAGE) {
                image = elements[0].asImage();
                title = image.getTitle();
            }
        }
    }
    return image && String(title || '').indexOf(EQUATION_TITLE) === 0 ? image : null;
}

/**
 * The equation selected in the document, for the sidebar: {latex, size, fg, bg, inline, key}, `key`
 * telling one selection from the next - or null when what is selected is not an equation.
 */
function getSelectedEquation() {
    var doc = active_(function () { return DocumentApp.getActiveDocument(); });
    var presentation = doc ? null : active_(function () { return SlidesApp.getActivePresentation(); });
    var image = selectedEquation_(doc, presentation);
    if (!image) return null;
    var title = doc ? image.getAltTitle() : image.getTitle();
    var latex = (doc ? image.getAltDescription() : image.getDescription()) || '';
    var style = styleOf_(title);
    style.latex = latex;
    style.key = title + '\n' + latex;
    return style;
}

/** What get() returns, or null if it throws - as the getActive...() of the host not running does. */
function active_(get) {
    try {
        return get() || null;
    } catch (e) {
        return null;
    }
}
