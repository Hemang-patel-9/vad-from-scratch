# fonts

Geist and Geist Mono, the two faces `layout.tsx` loads. Both are variable fonts
covering weights 100–900 in one file, which is why no separate bold is here.

They are checked in rather than fetched. `next/font/google` downloads the woff2
from `fonts.gstatic.com` during `next build`, and a build that reaches the
network is a build that can fail without anything being wrong with the code —
which is exactly what happens in the Docker build, where the request does not
get out. These are the same files that loader was fetching, taken from a build
that succeeded, so nothing about how the pages look has changed.

| File | Family | Subset |
| --- | --- | --- |
| `Geist-latin.woff2` | Geist | latin |
| `GeistMono-latin.woff2` | Geist Mono | latin |

Latin only. The Google loader also bundled latin-ext, Cyrillic and Vietnamese
subsets; the interface is English, so those were dropped and text outside the
latin range falls back to the system font. The latin subset is wider than it
sounds — it covers `—`, `·` and `−`, which the plot hints and the prose use.

Licensed under the [SIL Open Font License 1.1](https://github.com/vercel/geist-font/blob/main/LICENSE.TXT),
which permits redistribution. Upstream is <https://github.com/vercel/geist-font>.

To update them, download the woff2 that
`https://fonts.googleapis.com/css2?family=Geist:wght@100..900` serves for the
latin range and replace the files in place — the names are what `layout.tsx`
refers to.
