// Registers App directly instead of pointing package.json's "main" at
// expo/AppEntry.js, which resolves its App import with `../../App` --
// raw relative-path math from wherever the "expo" package physically sits
// on disk. In a pnpm workspace that's frequently not two directories above
// this app's root (hoisting can place it at the workspace root instead),
// so that trick breaks in ways this repo's mobile app hit directly. A
// same-directory import and a bare "expo" specifier (resolved through
// normal node_modules lookup, not relative-path math) sidestep it entirely.
import { registerRootComponent } from "expo";
import App from "./App";

registerRootComponent(App);
