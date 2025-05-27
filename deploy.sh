pnpm install
pnpm run build

[ $? -eq 0 ] && echo "Build successful, continuing with deployment..." || { echo "Build failed, aborting deployment"; exit 1; }

OBSIDIAN_VAULT_PATH="$HOME/Documents/Obsidian Vault"
cp main.js manifest.json styles.css "$OBSIDIAN_VAULT_PATH/.obsidian/plugins/llm-workspace/"

[ $? -eq 0 ] && echo "Done"

