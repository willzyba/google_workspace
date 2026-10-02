/**
 * CodeCogs Equation Editor - Google Docs & Slides add-on, server side.
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

var DEFAULT_SERVER = 'fxtex.codecogs.com';
var DEFAULT_RENDER_URL = 'https://latex.codecogs.com';

/** One add-on menu item, wired to whichever host (Docs or Slides) is running it. */
function onOpen(e) {
    getUi_()
        .createAddonMenu()
        .addItem('Insert equation...', 'showSidebar')
        .addToUi();
}

function onInstall(e) {
    onOpen(e);
}

function showSidebar() {
    var html = HtmlService.createHtmlOutputFromFile('Sidebar')
        .setTitle('Equation Editor')
        .setWidth(420);
    getUi_().showSidebar(html);
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
            throw new Error( 'CodeCogs Equation Editor: not running inside Docs or Slides.' );
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
    return {
        server: props.getProperty( 'EQNEDITOR_SERVER' ) || DEFAULT_SERVER,
        renderUrl: props.getProperty( 'EQNEDITOR_RENDER_URL' ) || DEFAULT_RENDER_URL,
        // Passed straight to EqEditor.init() - an empty licence is the normal, expected state
        // until a real one is configured, not a required property.
        licence: props.getProperty( 'EQNEDITOR_LICENCE' ) || '',
        // How the editor looks, as JSON - see the `design` option in the README.
        design: parseDesign( props.getProperty( 'EQNEDITOR_DESIGN' ) )
    };
}

/**
 * Fetches the rendered equation as an image and inserts it at the current cursor (Docs) or
 * onto the current slide (Slides). Fetching server-side, rather than asking the sidebar to
 * upload image bytes it fetched itself, means the render URL never needs to be reachable
 * from the sidebar's sandboxed iframe - only from Google's own servers, which is where
 * UrlFetchApp actually runs.
 *
 * The URL itself is built client-side, by EqEditor's own Output.exportAs('url') - the same
 * call every other adapter in this repo uses - rather than re-derived here from raw LaTeX,
 * because CodeCogs' own query-escaping for spaces/plus/hash is EqEditor's to get right, not
 * this add-on's to guess at a second time.
 *
 * @param {string} url The full rendering URL, from EqEditor's Output.exportAs('url').
 * @returns {{ok: boolean, message: string}}
 */
function insertEquation(url) {
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

    try {
        if (typeof DocumentApp !== 'undefined') {
            var doc = DocumentApp.getActiveDocument();
            var cursor = doc.getCursor();
            if (cursor) {
                cursor.insertInlineImage(blob);
            } else {
                doc.getBody().appendImage(blob);
            }
            return {ok: true, message: 'Equation inserted.'};
        }

        if (typeof SlidesApp !== 'undefined') {
            var presentation = SlidesApp.getActivePresentation();
            var selection = presentation.getSelection();
            var slide = selection && selection.getCurrentPage ? selection.getCurrentPage() : presentation.getSlides()[0];
            slide.insertImage(blob);
            return {ok: true, message: 'Equation inserted.'};
        }
    } catch (insertErr) {
        return {ok: false, message: 'Could not insert the equation: ' + insertErr.message};
    }

    return {ok: false, message: 'Not running inside Docs or Slides.'};
}
