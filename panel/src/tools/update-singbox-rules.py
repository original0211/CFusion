#!/usr/bin/env python3
"""下载固定版本的规则，生成客户端可直接使用的本地快照。"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from zoneinfo import ZoneInfo
import argparse,gzip,hashlib,json,subprocess,tempfile,urllib.request

parser=argparse.ArgumentParser(description='重建sing-box内置分流规则')
parser.add_argument('--revision',required=True,help='规则数据的完整提交号')
parser.add_argument('--sing-box',required=True,help='sing-box执行文件路径')
parser.add_argument('--output',default=str(Path(__file__).resolve().parent.parent/'singbox-rules.json.gz'))
args=parser.parse_args()
if len(args.revision)!=40 or any(c not in '0123456789abcdef' for c in args.revision):parser.error('请使用完整的40位提交号')
sources=[('geosite',name) for name in ['cn','private','apple','apple-cn','microsoft','microsoft@cn','google','telegram','openai','anthropic','youtube','netflix','disney','spotify','tiktok','twitter','facebook','github','geolocation-!cn','category-ads-all']]+[('geoip',name) for name in ['cn','private','telegram']]
def fetch(item):
 kind,name=item
 url='https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/'+args.revision+'/geo/'+kind+'/'+name+'.srs'
 with urllib.request.urlopen(url,timeout=30) as response:data=response.read()
 if data[:3]!=b'SRS':raise ValueError('规则文件格式不正确：'+name)
 return kind,name,data
with ThreadPoolExecutor(max_workers=6) as executor:downloads=list(executor.map(fetch,sources))
entries={};manifest=[]
with tempfile.TemporaryDirectory(prefix='cfnew-rules-') as directory:
 root=Path(directory)
 for kind,name,data in downloads:
  tag=kind+'-'+name;source=root/(tag+'.srs');source.write_bytes(data);output=root/(tag+'.json')
  subprocess.run([args.sing_box,'rule-set','decompile',str(source),'-o',str(output)],check=True,stdout=subprocess.DEVNULL)
  rules=json.loads(output.read_text())['rules']
  for rule in rules:
   if not set(rule)<=set(['domain','domain_suffix','domain_keyword','domain_regex','ip_cidr']):raise ValueError('规则字段超出已验证的兼容范围：'+tag)
  entries[tag]=rules
  manifest.append({'tag':tag,'sha256':hashlib.sha256(data).hexdigest(),'srsBytes':len(data)})
result={'revision':args.revision,'date':datetime.now(ZoneInfo('Asia/Singapore')).date().isoformat(),'license':'GPL-3.0','rules':entries,'sources':manifest}
payload=json.dumps(result,ensure_ascii=False,separators=(',',':')).encode()
output=Path(args.output);output.parent.mkdir(parents=True,exist_ok=True)
with tempfile.NamedTemporaryFile(dir=output.parent,prefix='.rules-',delete=False) as temp:
 temp.write(gzip.compress(payload,compresslevel=9,mtime=0));temporary=Path(temp.name)
temporary.chmod(0o644);temporary.replace(output)
print(json.dumps({'ruleSets':len(entries),'inlineBytes':len(payload),'gzipBytes':output.stat().st_size},ensure_ascii=False))
