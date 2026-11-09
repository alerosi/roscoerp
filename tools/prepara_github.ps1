# Prepara la cartella "pubblica_github" con i soli file da caricare su GitHub (dal sito, trascinandoli).
# Esclude i dati reali del negozio: data/, Reference/ (file Excel), config.json, backup, .claude/.
#
# Uso (PowerShell, dalla cartella del progetto):
#   powershell -ExecutionPolicy Bypass -File tools\prepara_github.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root "pubblica_github"

# Elenco esplicito di ciò che si pubblica: un file nuovo va aggiunto qui di proposito.
$voci = @(
  "index.html",
  "public",
  "server.js",
  "package.json",
  "README.md",
  "CLAUDE.md",
  ".gitignore",
  "docs",
  "tests",
  "tools\import_xlsm.py",
  "tools\prepara_github.ps1",
  "tools\pubblica_github.ps1",
  ".nojekyll"
)

if (Test-Path $out) { Remove-Item -Recurse -Force $out }
New-Item -ItemType Directory -Force $out | Out-Null

foreach ($v in $voci) {
  $src = Join-Path $root $v
  if (-not (Test-Path $src)) { Write-Warning "Manca: $v"; continue }
  $dst = Join-Path $out $v
  New-Item -ItemType Directory -Force (Split-Path -Parent $dst) | Out-Null
  Copy-Item -Recurse -Force $src $dst
}
# vecchia guida con dati personali: resta solo sul computer
Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $out "docs\GUIDA_GITHUB.pdf")

# Controllo finale: nessun file di dati deve essere finito nella cartella.
$sospetti = Get-ChildItem -Recurse -File $out | Where-Object {
  $_.Name -match '^roscoerp.*\.json$' -or $_.Extension -in '.xlsm', '.xlsx' -or $_.Name -eq 'config.json' -or $_.Name -eq 'GUIDA_GITHUB.pdf'
}
if ($sospetti) {
  Write-Error ("Trovati file di dati da non pubblicare:`n" + ($sospetti.FullName -join "`n"))
}

$files = Get-ChildItem -Recurse -File $out
$mb = [math]::Round((($files | Measure-Object Length -Sum).Sum) / 1MB, 2)
Write-Host "Pronta: $out ($($files.Count) file, $mb MB)."
Write-Host "Su github.com: Add file > Upload files, poi trascina TUTTO il contenuto della cartella (non la cartella stessa)."
