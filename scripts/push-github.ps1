param(
  [string]$RepoName = "applyatlas-ai",
  [ValidateSet("private", "public")]
  [string]$Visibility = "private",
  [string]$Message = "Update ApplyAtlas AI"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  throw "GitHub CLI is not installed or not on PATH."
}

if (-not (Test-Path ".git")) {
  git init -b main
}

git add -A

$hasChanges = git status --porcelain
if ($hasChanges) {
  git commit -m $Message
}

$remote = git remote get-url origin 2>$null
if (-not $remote) {
  $visibilityFlag = "--$Visibility"
  gh repo create $RepoName $visibilityFlag --source . --remote origin --push
} else {
  git push -u origin main
}
