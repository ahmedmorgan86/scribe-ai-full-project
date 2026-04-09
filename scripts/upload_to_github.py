import os
import time
import json
from nexttoken import NextToken

client = NextToken()

def get_repo_files(base_path="."):
    repo_files = []
    skip_dirs = {'.git', '.next', 'node_modules', 'dist', '__pycache__', 'public', 'apps', 'srgan_repo', 'logs', 'docs', 'workers', 'e2e'}
    for root, dirs, files in os.walk(base_path):
        dirs[:] = [d for d in dirs if d not in skip_dirs and not d.startswith('.')]
        for file in files:
            if file.startswith('.') or file.endswith('.h5') or file.endswith('.db') or file.endswith('.png') or file.endswith('.jpg'):
                continue
            repo_files.append(os.path.join(root, file))
    return repo_files

def upload_to_github():
    repo_name = "scribe-ai-social-content-creator-new"
    description = "Scribe AI - Professional Social Content Creator (Arabic Optimized)"
    
    print("Listing integrations...")
    integrations = client.integrations.list()
    
    github_connected = False
    if isinstance(integrations, list):
        github_connected = any(i.get('app_slug') == 'github' or i.get('slug') == 'github' for i in integrations)
    
    if not github_connected:
        print("GitHub integration not found in SDK list. Connect via UI button if needed.")
        return

    repo_fullname = None
    try:
        print(f"Checking for existing repository...")
        repos_response = client.integrations.invoke(
            app="github",
            function_key="github-list-repositories",
            args={"type": "owner", "sort": "pushed"}
        )
        repos = repos_response.get("result") if isinstance(repos_response, dict) else repos_response
        existing_repo = next((r for r in repos if isinstance(r, dict) and r.get('name') == repo_name), None)
        if existing_repo:
            repo_fullname = existing_repo.get('full_name')
    except Exception as e:
        print(f"Error checking repositories: {e}")

    if not repo_fullname:
        print(f"Creating repository '{repo_name}'...")
        try:
            create_response = client.integrations.invoke(
                app="github",
                function_key="github-create-repository",
                args={"name": repo_name, "description": description, "private": False}
            )
            result = create_response.get("result") if isinstance(create_response, dict) else create_response
            repo_fullname = result.get('full_name')
        except Exception as e:
            print(f"Error creating repository: {e}")
            return

    if not repo_fullname:
        print("Failed to get full repository name.")
        return

    files_to_upload = get_repo_files()
    test_files = [f for f in files_to_upload if '/' not in f.replace('./', '')][:10]
    
    print(f"Uploading files to {repo_fullname}...")
    for file_path in test_files:
        clean_path = file_path.replace('./', '')
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
            client.integrations.invoke(
                app="github",
                function_key="github-create-or-update-file-contents",
                args={
                    "repoFullname": repo_fullname,
                    "path": clean_path,
                    "fileContent": content,
                    "commitMessage": f"Initial upload: {clean_path}"
                }
            )
            print(f"Successfully uploaded {clean_path}")
            time.sleep(1)
        except Exception as e:
            print(f"Failed to upload {clean_path}: {e}")
            
    print(f"Final Repository: https://github.com/{repo_fullname}")

if __name__ == "__main__":
    upload_to_github()
