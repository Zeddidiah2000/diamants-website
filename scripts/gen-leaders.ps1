# Builds assets/stats-leaders.json for stats.html (LBJEQ League Leaders).
# Source: the LBJEQ league-leaderboard CSVs from the GameChanger sweep (in stats/leaderboards/).
# Single league (unlike Canonniers' 15U/17U split): datasets are just "b" and "p".
# Re-run after a new sweep:  pwsh scripts/gen-leaders.ps1
$ErrorActionPreference = 'Stop'
$inv  = [Globalization.CultureInfo]::InvariantCulture
$root = Split-Path $PSScriptRoot -Parent
$lead = Join-Path $root 'stats\leaderboards'
$out  = Join-Path $root 'assets\stats-leaders.json'

$batCols = @('GP','PA','AB','H','2B','3B','HR','RBI','R','BB','SO','SB','AVG','OBP','SLG','OPS','QAB%','BABIP')
$pitCols = @('IP','W','L','SV','SO','BB','H','R','ER','HR','ERA','WHIP','BAA','FIP','K/BB','K/G')

$teams   = New-Object System.Collections.Generic.List[string]
$teamIdx = @{}
function TeamId($name){ if(-not $teamIdx.ContainsKey($name)){ $teamIdx[$name] = $teams.Count; $teams.Add($name) }; $teamIdx[$name] }

function Val($s){
  if($null -eq $s -or "$s".Trim() -eq ''){ return $null }
  $t = "$s".Trim()
  if($t -match '^-?\d+$'){ return [int]$t }
  $d = 0.0; if([double]::TryParse($t,[Globalization.NumberStyles]::Float,$inv,[ref]$d)){ return $d }
  return $t
}
function Load($file,$cols){
  $rows = @()
  Import-Csv $file | ForEach-Object {
    $r = $_
    $arr = New-Object System.Collections.ArrayList
    [void]$arr.Add($r.Player)
    [void]$arr.Add((TeamId $r.Team))
    [void]$arr.Add((Val $r.Number))
    foreach($c in $cols){ [void]$arr.Add((Val $r.$c)) }
    $rows += ,$arr
  }
  ,$rows
}

$b = Load "$lead\LBJEQ_batting_leaderboard.csv"  $batCols
$p = Load "$lead\LBJEQ_pitching_leaderboard.csv" $pitCols

$obj = [ordered]@{
  generated = (Get-Date).ToString('yyyy-MM-dd')
  cols  = [ordered]@{ b = $batCols; p = $pitCols }
  teams = $teams.ToArray()
  b = $b; p = $p
}
New-Item -ItemType Directory -Force -Path (Split-Path $out) | Out-Null
$obj | ConvertTo-Json -Depth 6 -Compress | Set-Content -Path $out -Encoding utf8
"wrote {0} ({1:N1} KB) | {2} teams | b {3}  p {4}" -f (Split-Path $out -Leaf), ((Get-Item $out).Length/1KB), $teams.Count, $b.Count, $p.Count
"teams: $($teams -join ' | ')"