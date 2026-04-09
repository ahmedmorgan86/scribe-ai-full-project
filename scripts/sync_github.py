import os
import time
from nexttoken import NextToken

client = NextToken()
REPO_FULLNAME = "ahmedmorgan86/scribe-ai-full-project"

def get_repo_files(base_path="."):
    repo_files = []
    # Skip standard large/binary directories
    skip_dirs = {'.git', '.next', 'node_modules', 'dist', '__pycache__', 'public', '.logs', '.tmp'}
    for root, dirs, files in os.walk(base_path):
        dirs[:] = [d for d in dirs if d not in skip_dirs and not d.startswith('.')]
        for file in files:
            # Skip hidden and binary files
            if file.startswith('.') or file.endswith('.h5') or file.endswith('.db') or file.endswith('.png') or file.endswith('.jpg'):
                continue
            repo_files.append(os.path.join(root, file))
    return repo_files

def upload_files():
    files = get_repo_files()
    print(f"Syncing {len(files)} files to {REPO_FULLNAME}...")
    
    for file_path in files:
        clean_path = os.path.relpath(file_path, ".")
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            print(f"Uploading {clean_path}...")
            client.integrations.invoke(
                app="github",
                function_key="github-create-or-update-file-contents",
                args={
                    "repoFullname": REPO_FULLNAME,
                    "path": clean_path,
                    "fileContent": content,
                    "commitMessage": f"Sync {clean_path}"
                }
            )
            time.sleep(1.2) # Small delay to respect GitHub API
        except Exception as e:
            print(f"Error syncing {clean_path}: {e}")

if __name__ == "__main__":
    upload_files()
