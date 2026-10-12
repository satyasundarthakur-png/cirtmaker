# Cirtmaker

deploy the uploaded web app

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://cirtmaker.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/9a305fb1-2059-4a72-b05d-376f93bc79d8).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Selection-aware AI editing

Text selections, bulk edits, reviewed old/new previews, ranked style matches, protected layers and unlimited session undo/redo are implemented in `src/features/certmaker/lib/editing`. See [migration and usage](docs/AI_EDITING_MIGRATION.md) and [file-by-file implementation](docs/AI_EDITING_IMPLEMENTATION.md).
