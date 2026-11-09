<#
  Pubblica (o aggiorna) RoscoERP su GitHub e attiva GitHub Pages.

  Prima volta e ogni aggiornamento, dalla cartella del progetto:
    powershell -ExecutionPolicy Bypass -File tools\pubblica_github.ps1
  Con un messaggio a scelta:
    powershell -ExecutionPolicy Bypass -File tools\pubblica_github.ps1 -Messaggio "Nuovo report"

  Cosa fa: controlla git e GitHub CLI, fa accedere all'account (una sola volta, dal browser),
  prepara il commit, BLOCCA tutto se trova dati del negozio, nomi degli operatori o email,
  crea il repository pubblico se manca, invia le modifiche e attiva GitHub Pages.
#>
param(
  [string]$Account = "alerosi",
  [string]$Repo = "roscoerp",
  [string]$Messaggio = "",
  # solo i controlli di sicurezza ed elenco dei file, senza accesso a GitHub, commit o invio
  [switch]$SoloControllo
)

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# account gh attivo prima dello script (es. quello di lavoro): viene rimesso attivo alla fine
$script:prevAccount = $null
function Restore-Account {
  if ($script:prevAccount -and $script:prevAccount -ne $Account) {
    gh auth switch --hostname github.com --user $script:prevAccount *> $null
    Write-Host "(account GitHub attivo rimesso a '$($script:prevAccount)')"
  }
}
function Fail($msg) { Write-Host "`nERRORE: $msg" -ForegroundColor Red; Restore-Account; exit 1 }
function Step($msg) { Write-Host "`n== $msg" -ForegroundColor Cyan }

# ------------------------------------------------------------------ 1. strumenti
Step "Controllo di git e GitHub CLI"
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail "git non è installato. Esegui: winget install --id Git.Git -e   e poi riapri PowerShell." }
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Fail "GitHub CLI non è installata. Esegui: winget install --id GitHub.cli -e   e poi riapri PowerShell." }
Write-Host "ok"

# ------------------------------------------------------------------ 2. accesso a GitHub
if (-not $SoloControllo) {
Step "Accesso a GitHub"
# gh può tenere più account: si usa '$Account' senza scollegare gli altri (es. quello di lavoro)
$attivo = gh api user --jq .login 2>$null
if ($LASTEXITCODE -eq 0 -and $attivo) { $script:prevAccount = "$attivo".Trim() }
gh auth switch --hostname github.com --user $Account *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "Primo accesso con l'account '$Account'." -ForegroundColor Yellow
  Write-Host "Si apre una finestra InPrivate di Edge su github.com/login/device: lì accedi come '$Account'"
  Write-Host "(non con l'account di lavoro) e incolla il codice di 8 caratteri che compare qui sotto"
  Write-Host "(è già copiato negli appunti: Ctrl+V). Se non si apre, apri tu una finestra InPrivate"
  Write-Host "(Ctrl+Maiusc+N) e vai su https://github.com/login/device"
  Write-Host "Se viene chiesto 'Authenticate Git with your GitHub credentials?' rispondi n." -ForegroundColor Yellow
  Write-Host ""
  try { Start-Process msedge -ArgumentList "--inprivate", "https://github.com/login/device" } catch { }
  # il browser predefinito resterebbe collegato all'account di lavoro: gh non lo apre
  $env:GH_BROWSER = "cmd /c rem"
  gh auth login --hostname github.com --git-protocol https --web --clipboard
  $okLogin = $LASTEXITCODE -eq 0
  Remove-Item Env:GH_BROWSER -ErrorAction SilentlyContinue
  if (-not $okLogin) { Fail "accesso a GitHub non riuscito." }
}
$user = gh api user | ConvertFrom-Json
if (-not $user -or -not $user.login) { Fail "non riesco a leggere l'account GitHub collegato." }
$owner = $user.login
if ($owner -ne $Account) {
  Fail ("l'accesso è stato fatto con '$owner' invece che con '$Account'. Rilancia lo script e, nella finestra InPrivate, " +
        "accedi a GitHub come '$Account'. (L'account '$owner' resta collegato: per toglierlo da gh, solo se vuoi: gh auth logout --user $owner)")
}
Write-Host "collegato come $owner"
}

# ------------------------------------------------------------------ 3. repository locale
Step "Repository locale"
if (-not (Test-Path (Join-Path $root ".git"))) {
  git init -q -b main
  if ($LASTEXITCODE -ne 0) { Fail "git init non riuscito." }
  Write-Host "creato"
} else { Write-Host "già presente" }
git config core.autocrlf false   # i file restano come sono (LF), senza avvisi
# autore dei commit: nome utente GitHub ed email anonima di GitHub (mai l'email personale o di lavoro)
if (-not $SoloControllo) {
  git config user.name $owner
  git config user.email "$($user.id)+$owner@users.noreply.github.com"
  # credenziali SOLO per questo progetto: git usa l'account '$Account' di gh, non quelle salvate in
  # Windows (che potrebbero essere dell'account di lavoro); la configurazione globale non cambia
  $gitCfg = Join-Path $root ".git\config"
  if (-not (Select-String -Path $gitCfg -SimpleMatch "gh auth git-credential" -Quiet)) {
    Add-Content -Path $gitCfg -Encoding Ascii -Value "[credential `"https://github.com`"]`n`thelper =`n`thelper = !gh auth git-credential"
  }
}

# ------------------------------------------------------------------ 4. controlli di sicurezza
Step "Controllo di cosa verrà pubblicato"
git add -A
if ($LASTEXITCODE -ne 0) { Fail "git add non riuscito." }
$files = @(git ls-files)

$vietati = $files | Where-Object {
  $_ -match '^(data|Reference)/' -or $_ -match '(^|/)config\.json$' -or $_ -match '\.(xlsm|xlsx|xls)$' -or
  $_ -match '(^|/)roscoerp[^/]*\.json$' -or $_ -match 'GUIDA_GITHUB' -or $_ -match '^\.claude/' -or $_ -match '(^|/)backup_'
}
if ($vietati) { git reset -q; Fail ("questi file non devono essere pubblicati:`n  " + ($vietati -join "`n  ")) }

# parole che non devono comparire nei file: nomi degli operatori (letti dal database) ed email di git
$parole = @()
$dbPath = Join-Path $root "data\roscoerp.json"
$cfgPath = Join-Path $root "config.json"
if (Test-Path $cfgPath) {
  try { $cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json; if ($cfg.dbPath) { $dbPath = if ([IO.Path]::IsPathRooted($cfg.dbPath)) { $cfg.dbPath } else { Join-Path $root $cfg.dbPath } } } catch { }
}
if (Test-Path $dbPath) {
  $testo = [IO.File]::ReadAllText($dbPath)
  $m = [regex]::Match($testo, '"operatori"\s*:\s*(\[[^\]]*\])')
  if ($m.Success) {
    # in Windows PowerShell 5.1 ConvertFrom-Json restituisce l'array come un solo oggetto: va scorso a mano
    $ops = $m.Groups[1].Value | ConvertFrom-Json
    foreach ($o in $ops) { $parole += [string]$o }
  }
} else {
  Write-Host "Attenzione: database non trovato ($dbPath), salto il controllo dei nomi degli operatori." -ForegroundColor Yellow
}
foreach ($scope in "--global", "--system") {
  $e = git config $scope user.email 2>$null
  if ($e) { $parole += $e }
}
$parole = $parole | Where-Object { $_ -and $_.Trim().Length -ge 3 } | Sort-Object -Unique

$trovati = @()
foreach ($p in $parole) {
  $hit = @(git grep --cached -l -i -F -e $p)
  if ($hit.Count -gt 0) { $trovati += "  '$p' in: " + ($hit -join ", ") }
}
if ($trovati.Count -gt 0) { git reset -q; Fail ("nei file da pubblicare ci sono nomi o email da togliere:`n" + ($trovati -join "`n")) }
Write-Host "ok: $($files.Count) file, nessun dato del negozio, nessun nome di operatore o email"
if ($SoloControllo) {
  git reset -q
  Write-Host "`nFile che verrebbero pubblicati:"
  $files | ForEach-Object { Write-Host "  $_" }
  Write-Host "`nSolo controllo: nulla è stato inviato." -ForegroundColor Green
  exit 0
}

# ------------------------------------------------------------------ 5. commit
Step "Commit"
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
  git rev-parse --verify HEAD *> $null
  $primo = $LASTEXITCODE -ne 0
  if (-not $Messaggio) { $Messaggio = if ($primo) { "Prima versione" } else { "Aggiornamento " + (Get-Date -Format "yyyy-MM-dd HH:mm") } }
  git commit -q -m $Messaggio
  if ($LASTEXITCODE -ne 0) { Fail "commit non riuscito." }
  Write-Host "creato: $Messaggio"
} else { Write-Host "nessuna modifica da pubblicare" }

# ------------------------------------------------------------------ 6. invio su GitHub
Step "Invio su GitHub"
$full = "$owner/$Repo"
git remote get-url origin *> $null
if ($LASTEXITCODE -ne 0) {
  gh repo view $full *> $null
  if ($LASTEXITCODE -ne 0) {
    gh repo create $full --public --description "Gestionale per negozio di ceramica artistica (i dati restano sul dispositivo)" --source . --remote origin --push
    if ($LASTEXITCODE -ne 0) { Fail "creazione del repository non riuscita." }
  } else {
    git remote add origin "https://github.com/$full.git"
    git push -u origin main
    if ($LASTEXITCODE -ne 0) { Fail "push non riuscito: il repository $full esiste già con altri contenuti? Se è vuoto o di prova, cancellalo da github.com e rilancia." }
  }
} else {
  git push -u origin main
  if ($LASTEXITCODE -ne 0) { Fail "push non riuscito." }
}

# ------------------------------------------------------------------ 7. GitHub Pages
Step "GitHub Pages"
gh api "repos/$full/pages" *> $null
if ($LASTEXITCODE -ne 0) {
  gh api -X POST "repos/$full/pages" -f "source[branch]=main" -f "source[path]=/" *> $null
  if ($LASTEXITCODE -ne 0) { Fail "attivazione di GitHub Pages non riuscita: attivala a mano da Settings > Pages (branch main, cartella / root)." }
  Write-Host "attivato"
} else { Write-Host "già attivo" }

Restore-Account
$url = "https://$($owner.ToLower()).github.io/$Repo/"
Write-Host "`nFATTO." -ForegroundColor Green
Write-Host "Codice:  https://github.com/$full"
Write-Host "App:     $url   (online dopo 1-2 minuti)"
