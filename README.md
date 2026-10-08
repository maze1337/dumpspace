# Offset Atlas

A static website for browsing SDK dumps of your own games. It shows every class, struct, function, enum and global offset in a dump, and draws a memory map for each type so you can see where its members sit, which bytes it inherits and which bytes nothing describes.

It reads the Dumpspace JSON format that [Dumper-7](https://github.com/Encryqed/Dumper-7) and [UEDumper](https://github.com/Spuckwaffel/UEDumper) write (`ClassesInfo`, `StructsInfo`, `FunctionsInfo`, `EnumsInfo` and `OffsetsInfo`), for Unreal Engine 3, 4 and 5 and for Unity. There is no build step and no server code, so it runs on GitHub Pages as is.

## What it does

- **Game list** with filtering by name and engine.
- **Classes and structs** with size, inheritance chain, own and inherited members, bitfields, C arrays and templates. Type names link to their definitions.
- **Memory map** for every type: inherited bytes, members coloured by kind, and unknown bytes (padding or data the dump does not describe). Switch between the whole type and only the part the type adds.
- **Unknown bytes** are listed as rows in the member table, so gaps are easy to spot.
- **C++ view** that turns any class, struct, enum, function list or the offsets into code with padding, bitfield padding and a `static_assert` on the size.
- **Functions** with return types, parameters, flags and addresses relative to the module base.
- **Enums** with values in decimal and hex.
- **Global offsets** such as `OFFSET_GWORLD` and `OFFSET_GOBJECTS`.
- **Search everything** with `/` or `Ctrl+K`: types, members, functions and enum values. Write `UWorld::Owning` to search inside one type.
- **Hex or decimal** for every offset and size.
- **Open dumps from your computer** without adding them to the site: use the buttons on the home page or drop the files on the page. They are read in the browser and never uploaded.
- Links to every type and member, light and dark themes, and a layout that works on phones.

## Run it locally

You need [Node.js](https://nodejs.org) 18 or newer.

```bash
node tools/serve.mjs
```

Then open http://localhost:8080. Opening `index.html` straight from disk does not work, because browsers block loading the dump files from `file://` pages.

## Add a game

1. Dump the game with Dumper-7 or UEDumper. Dumper-7 writes the five JSON files into a folder named `Dumpspace` inside its output folder.
2. Add the dump to the site:

   ```bash
   node tools/games.mjs add "C:\Dumper-7\5.3.2-MyGame\Dumpspace" --engine Unreal-Engine-5 --name "My Game"
   ```

   `--engine` is one of `Unreal-Engine-5`, `Unreal-Engine-4`, `Unreal-Engine-3` or `Unity`. Optional: `--uploader "Your name"`, `--link https://...`, and `--keep-json` to also keep uncompressed copies.

3. Commit and push the `games` folder.

The tool gzips the files into `games/<engine>/<game>/` and adds the game to `games/GameList.json`. Running `add` again with the same engine and name updates the game and keeps its link.

Other commands:

```bash
node tools/games.mjs list
node tools/games.mjs remove "My Game"
```

The site ships with a made-up **Sample Project** so there is something to click on. Remove it once you have added your own games:

```bash
node tools/games.mjs remove "Sample Project"
```

## Publish with GitHub Pages

1. Push this repository to GitHub.
2. Open **Settings → Pages**, choose **Deploy from a branch**, then the `main` branch and the `/ (root)` folder.
3. The site appears at `https://<your-user>.github.io/<repository>/` after a minute or two. For this repository that is https://maze1337.github.io/dumpspace/.

GitHub Pages is free for public repositories. Private repositories need a paid GitHub plan for Pages, and the published site is still reachable by anyone with the link unless you use GitHub Enterprise Cloud.

## Use the data from C++

The `games` folder uses the same layout as the original Dumpspace repository (`GameList.json`, then `<engine>/<game>/<File>.json.gz`). The [Dumpspace API](https://github.com/Spuckwaffel/Dumpspace-API) for C++ can therefore read from your site: in `DSAPI.h`, point `website` at `https://maze1337.github.io/dumpspace/games/` and `gameList` at `https://maze1337.github.io/dumpspace/games/GameList.json`, then use the hash shown by `node tools/games.mjs list`.

## Change the name

Edit `assets/js/config.js` (site name, tagline and an optional link to your repository) and the `<title>` in `index.html`.

## Files

```
index.html              the page
assets/css/app.css      styles and colour themes
assets/js/app.js        start-up, routing, shortcuts, drag and drop
assets/js/data.js       loading GameList.json and the dump files, search index
assets/js/format.js     parsing the dump format, memory layout, C++ output
assets/js/game.js       game screen: tabs, type list
assets/js/detail.js     class, struct, enum and function views, memory map
assets/js/overview.js   game overview and offsets page
assets/js/home.js       home page and opening local dumps
assets/js/search.js     search across the whole dump
assets/js/config.js     site name and paths
games/                  GameList.json and one folder per game
tools/games.mjs         add, update, list and remove games
tools/serve.mjs         local web server
```

## Notes on the format

- Both format versions are supported: 10202 (bitfields carry a bit offset) and the older 10201.
- Unity dumps have no sizes, so Unity types show their members and offsets but no memory map or padding.
- Offsets of `-1` in Unity dumps are static or constant fields and are shown as `static`.

The dump format comes from [Dumpspace](https://github.com/Spuckwaffel/dumpspace) by Spuckwaffel. This site's code is written separately and only shares the file format.
