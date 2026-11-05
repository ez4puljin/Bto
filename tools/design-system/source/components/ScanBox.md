The visible scan box: a keyboard-wedge scanner works with or without focus here, a code can be typed, and a camera button appears where the page may open one.

**When:** any editor that takes barcodes. Pass `autoFocus` when a document was just created from a dialog.

**Props:** `onScan(code)`, `letters` (shelf labels such as `A-01-03`, on any keyboard layout), `disabled`, `autoFocus`, `label`, `placeholder`.

**Behaviour:** it reads nothing while `disabled` or while a dialog that does not hold it is open, and a scan's Enter never presses a button. Scanners beep themselves: no sounds.

The bundle leaves the camera out, so the camera button does not show here. Try it: type digits and press Enter, or type them fast, as a wedge scanner does, with the focus anywhere in the card.
