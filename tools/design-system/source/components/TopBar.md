The sticky white bar above every signed-in page: ⋮⋮ «Бүх цэс», the brand, the modules as menus, then search, favourites, the bell, the assistant, «Систем» and the account.

**Rules:** the open page's module is tinted `secondary`. Modules show from `lg`; the search is a pill with its shortcut from `2xl`, an icon button below. Ctrl/⌘+K opens the search on any keyboard layout. A new menu group must join a module (a test checks); the module list is `NAV_MODULES` in `app/nav-items.ts`.

The preview signs in a test user holding every right and shows an empty bell, so nothing reads a server. The drawer and the search dialog belong to the app shell: here they only say their name.
