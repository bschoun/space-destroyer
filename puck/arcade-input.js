// Button message numbers
const A_BUTTON = 0;
const B_BUTTON = 1;
const UP_BUTTON = 2;
const DOWN_BUTTON = 3;
const LEFT_BUTTON = 4;
const RIGHT_BUTTON = 5;
const MENU_BUTTON = 6;
const RESET_BUTTON = 7;

// Dictionary holding the button states
let buttons = new Map();
buttons.set(A_BUTTON, false);
buttons.set(B_BUTTON, false);
buttons.set(UP_BUTTON, false);
buttons.set(DOWN_BUTTON, false);
buttons.set(LEFT_BUTTON, false);
buttons.set(RIGHT_BUTTON, false);
buttons.set(MENU_BUTTON, false);
buttons.set(RESET_BUTTON, false);

// Get the simframe element
const simframe = document.getElementById('simframe');
var simframeUrl = undefined;

// Set the button value
function set_button(button, value) {
    // Get the simframe URL if we haven't gotten it already
    if (simframeUrl == undefined) {
        simframeUrl = simframe.getAttribute("src");
    }
    if (buttons.get(button) != value) {
        simframe.contentWindow.postMessage({
            button: button,
            pressed: value
        }, simframeUrl);
        buttons.set(button, value);
    }
}