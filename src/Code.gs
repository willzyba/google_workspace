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

var DEFAULT_SERVER = 'fxtex.codecogs.com';
var DEFAULT_RENDER_URL = 'https://fxtex.codecogs.com';

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
        .setTitle('LaTeX Equation Editor')
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
 * Fetches the rendered equation as a PNG and inserts it at the current cursor (Docs) or
 * onto the current slide (Slides). Fetching server-side, rather than asking the sidebar to
 * upload image bytes it fetched itself, means the render URL never needs to be reachable
 * from the sidebar's sandboxed iframe - only from Google's own servers, which is where
 * UrlFetchApp actually runs.
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
 * Its LaTeX goes in the image's alt text, for screen readers.
 *
 * @param {string} url The full rendering URL, from EqEditor's Output.getEquationURL().
 * @param {string} latex The equation's LaTeX, for the alt text.
 * @param {number} dpi What a normal-size equation is rendered at - EQUATION_DPI in Sidebar.html.
 * @returns {{ok: boolean, message: string}}
 */
function insertEquation(url, latex, dpi) {
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
    function fit(image) {
        image.setWidth(Math.max(1, Math.round(image.getWidth() * scale)));
        image.setHeight(Math.max(1, Math.round(image.getHeight() * scale)));
    }

    try {
        if (typeof DocumentApp !== 'undefined') {
            var doc = DocumentApp.getActiveDocument();
            var cursor = doc.getCursor();
            var image = cursor ? cursor.insertInlineImage(blob) : doc.getBody().appendImage(blob);
            if (!image) {
                return {ok: false, message: 'An equation cannot go there - put the cursor in some text.'};
            }
            fit(image);
            if (latex) image.setAltDescription(latex);
            return {ok: true, message: 'Equation inserted.'};
        }

        if (typeof SlidesApp !== 'undefined') {
            var presentation = SlidesApp.getActivePresentation();
            var selection = presentation.getSelection();
            var slide = selection && selection.getCurrentPage ? selection.getCurrentPage() : presentation.getSlides()[0];
            var picture = slide.insertImage(blob);
            fit(picture);
            if (latex) picture.setDescription(latex);
            return {ok: true, message: 'Equation inserted.'};
        }
    } catch (insertErr) {
        return {ok: false, message: 'Could not insert the equation: ' + insertErr.message};
    }

    return {ok: false, message: 'Not running inside Docs or Slides.'};
}
