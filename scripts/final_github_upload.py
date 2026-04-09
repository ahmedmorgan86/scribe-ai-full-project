import os
import time
from nexttoken import NextToken

client = NextToken()
REPO_FULLNAME = "ahmedmorgan86/scribe-ai-full-project"

def get_repo_files(base_path="."):
    repo_files = []
    # Only upload root files and key directories for the final handoff
    # This avoids timeouts and keeps the repo clean
    include_dirs = {'src', 'backend', 'config', 'scripts'}
    for root, dirs, files in os.walk(base_path):
        # Filter directories
        rel_root = os.path.relpath(root, base_path)
        if rel_root != '.':
            top_dir = rel_root.split(os.sep)[0]
            if top_dir not in include_dirs:
                continue
        
        # Filter files
        for file in files:
            if file.startswith('.') or file.endswith('.h5') or file.endswith('.db'):
                continue
            repo_files.append(os.path.join(root, file))
    return repo_files

def upload_files():
    files = get_repo_files()
    print(f"Uploading {len(files)} files to {REPO_FULLNAME}...")
    
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
                    "commitMessage": f"Add {clean_path}"
                }
            )
            time.sleep(1.5) # Be gentle with the API
        except Exception as e:
            print(f"Error uploading {clean_path}: {e}")

if __name__ == "__main__":
    upload_files()
