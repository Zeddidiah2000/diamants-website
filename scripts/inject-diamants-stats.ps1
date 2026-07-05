# Injects the Diamants team's GameChanger season stats (batting + pitching +
# catcher fielding) into diamants-db via the roster worker.
#   PUT https://diamants-roster-worker.chisholm2000.workers.dev/api/players/:id/stats
#   auth: Bearer ADMIN_TOKEN (workers/diamants-roster-worker/.admin-token.txt)
# Source CSVs: stats/LBJEQ_Diamants_de_Qu_bec_{batting,pitching_fielding}.csv
# Match: roster.number -> CSV Number (name fallback). Pitching only if IP>0;
# catching only if innings caught (outs:C) > 0.
$ErrorActionPreference = 'Stop'
$inv  = [Globalization.CultureInfo]::InvariantCulture
$root = Split-Path $PSScriptRoot -Parent
$API  = 'https://diamants-roster-worker.chisholm2000.workers.dev'
$SEASON = '2026'
$token = (Get-Content (Join-Path $root 'workers\diamants-roster-worker\.admin-token.txt') -Raw).Trim()

function ToNum($v){ if($null -eq $v -or "$v".Trim() -eq ''){ return $null } [double]::Parse("$v",$inv) }
function Cnt($v){ $d = ToNum $v; if($null -eq $d){ return $null } [int][math]::Round($d) }
function Rate3($v){ $d = ToNum $v; if($null -eq $d){ return $null }
  $s = $d.ToString('0.000',$inv); if($s.StartsWith('0.')){ $s = $s.Substring(1) }; $s }
function Dec2($v){ $d = ToNum $v; if($null -eq $d){ return $null } $d.ToString('0.00',$inv) }
function IpThirds($v){ $d = ToNum $v; if($null -eq $d){ return $null }
  $o = [int][math]::Round($d*3); "{0}.{1}" -f [math]::Floor($o/3), ($o%3) }
function CInn($outs){ $o=[int]$outs; "{0}.{1}" -f [math]::Floor($o/3), ($o%3) }
function CsPct($v){ $d = ToNum $v; if($null -eq $d){ return $null } ($d*100).ToString('0.0',$inv) }
# add k=v to an ordered hashtable only when non-null
function Put($h,$k,$v){ if($null -ne $v){ $h[$k]=$v } }

$roster = Invoke-RestMethod "$API/api/players" -TimeoutSec 30
$bat = Import-Csv (Join-Path $root 'stats\LBJEQ_Diamants_de_Qu_bec_batting.csv')
$def = Import-Csv (Join-Path $root 'stats\LBJEQ_Diamants_de_Qu_bec_pitching_fielding.csv')
$batByNum = @{}; foreach($b in $bat){ $batByNum["$($b.Number)"] = $b }
$defByNum = @{}; foreach($d in $def){ $defByNum["$($d.Number)"] = $d }

# Union of everyone with a batting OR a defense row — pure pitchers (DH league)
# have NO batting row, so iterating the batting CSV alone drops them.
$allNums = @(); foreach($n in (@($bat | ForEach-Object { "$($_.Number)" }) + @($def | ForEach-Object { "$($_.Number)" }))){
  if($n -ne '' -and $allNums -notcontains $n){ $allNums += $n } }

$updated=0; $unmatched=@()
foreach($num in $allNums){
  $r = $batByNum[$num]; $d = $defByNum[$num]
  $srcName = if($r){ $r.Player } elseif($d){ $d.Player } else { $num }
  $pl = $roster | Where-Object { [int]$_.number -eq [int]$num } | Select-Object -First 1
  if(-not $pl){ $pl = $roster | Where-Object { "$($_.first_name) $($_.last_name)".Trim() -eq $srcName.Trim() } | Select-Object -First 1 }
  if(-not $pl){ $unmatched += "#$num $srcName"; continue }

  $body = [ordered]@{ season=$SEASON }
  $tags = @()
  if($r){
    $batting = [ordered]@{}
    Put $batting 'GP' (Cnt $r.GP); Put $batting 'PA' (Cnt $r.PA); Put $batting 'AB' (Cnt $r.AB)
    Put $batting 'R' (Cnt $r.R); Put $batting 'H' (Cnt $r.H)
    Put $batting '1B' (Cnt $r.'1B'); Put $batting '2B' (Cnt $r.'2B'); Put $batting '3B' (Cnt $r.'3B')
    Put $batting 'HR' (Cnt $r.HR); Put $batting 'RBI' (Cnt $r.RBI); Put $batting 'BB' (Cnt $r.BB)
    Put $batting 'SO' (Cnt $r.SO); Put $batting 'HBP' (Cnt $r.HBP); Put $batting 'SB' (Cnt $r.SB); Put $batting 'CS' (Cnt $r.CS)
    Put $batting 'AVG' (Rate3 $r.AVG); Put $batting 'OBP' (Rate3 $r.OBP); Put $batting 'SLG' (Rate3 $r.SLG); Put $batting 'OPS' (Rate3 $r.OPS)
    $body.batting = $batting; $tags += 'bat'
  }
  if($d){
    $ip = ToNum $d.IP
    if($ip -ne $null -and $ip -gt 0){
      $pit = [ordered]@{}
      Put $pit 'GP' (Cnt $d.'GP:P'); Put $pit 'GS' (Cnt $d.GS); Put $pit 'W' (Cnt $d.W); Put $pit 'L' (Cnt $d.L); Put $pit 'SV' (Cnt $d.SV)
      Put $pit 'IP' (IpThirds $d.IP); Put $pit 'H' (Cnt $d.H); Put $pit 'R' (Cnt $d.R); Put $pit 'ER' (Cnt $d.ER); Put $pit 'HR' (Cnt $d.HR)
      Put $pit 'BB' (Cnt $d.BB); Put $pit 'SO' (Cnt $d.SO); Put $pit 'HBP' (Cnt $d.HBP); Put $pit 'BF' (Cnt $d.BF)
      Put $pit 'ERA' (Dec2 $d.ERA); Put $pit 'WHIP' (Dec2 $d.WHIP); Put $pit 'BAA' (Rate3 $d.BAA); Put $pit 'FIP' (Dec2 $d.FIP)
      $body.pitching = $pit; $tags += 'pit'
    }
    $oc = Cnt $d.'outs:C'
    if($oc -ne $null -and $oc -gt 0){
      $cat = [ordered]@{}
      Put $cat 'INN' (CInn $oc); Put $cat 'PO' (Cnt $d.PO); Put $cat 'A' (Cnt $d.A); Put $cat 'E' (Cnt $d.E); Put $cat 'DP' (Cnt $d.DP)
      Put $cat 'FPCT' (Rate3 $d.FPCT); Put $cat 'PB' (Cnt $d.'PB:C'); Put $cat 'SB' (Cnt $d.'SB:C'); Put $cat 'CS' (Cnt $d.'CS:C')
      Put $cat 'CS%' (CsPct $d.'CS:C%'); Put $cat 'PIK' (Cnt $d.'PIK:C'); Put $cat 'CI' (Cnt $d.'CI:C')
      $body.catching = $cat; $tags += 'catch'
    }
  }

  if($tags.Count -eq 0){ continue }   # no batting, pitching, or catching — skip

  $json = $body | ConvertTo-Json -Depth 5 -Compress
  try {
    Invoke-RestMethod "$API/api/players/$($pl.id)/stats" -Method PUT -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json' -Body $json -TimeoutSec 30 | Out-Null
    $updated++
    "  OK  #{0,-3} {1,-24} [{2}]" -f $num, "$($pl.first_name) $($pl.last_name)", ($tags -join '+')
  } catch { "  ERR #$num $($pl.first_name) $($pl.last_name): $($_.Exception.Message)" }
}
"`nUpdated $updated / $($allNums.Count).  Unmatched: $($unmatched -join ', ')"