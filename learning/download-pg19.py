"""Download a reproducible subset of PG-19, verifying the bucket's object MD5.

Run on a machine able to reach the public Google Cloud Storage bucket. PG-19
contains historical books; consult its README for provenance and limitations.
"""
import argparse
import base64
import csv
import hashlib
import json
import os
import random
import re
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

API = 'https://storage.googleapis.com/storage/v1/b/deepmind-gutenberg/o'


def fetch(url):
    for attempt in range(5):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                return r.read()
        except Exception:
            if attempt == 4:
                raise
            time.sleep(2 ** attempt)


def list_split(split):
    token = None
    while True:
        query = {'prefix': split + '/', 'maxResults': 1000}
        if token:
            query['pageToken'] = token
        result = json.loads(fetch(API + '?' + urllib.parse.urlencode(query)))
        for item in result.get('items', []):
            if re.fullmatch(split + r'/\d+\.txt', item['name']):
                yield item
        token = result.get('nextPageToken')
        if not token:
            break


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--metadata', required=True)
    ap.add_argument('--bytes', type=int, default=650_000_000)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    with open(args.metadata, encoding='utf-8', newline='') as f:
        books = {row[0]: {'title': row[1], 'year': row[2], 'gutenberg': row[3]} for row in csv.reader(f) if len(row) >= 4}
    train, validation = list(list_split('train')), list(list_split('validation'))
    def idof(obj):
        return obj['name'].split('/')[-1][:-4]
    def grammar(obj):
        title = books.get(idof(obj), {}).get('title', '').lower()
        return bool(re.search(r'english grammar|english conversation|english language|english composition', title))
    # First ensure books specifically about English grammar/conversation; then a reproducibly shuffled mix.
    priority = [x for x in train if grammar(x)]
    other = [x for x in train if not grammar(x)]
    random.Random(75100).shuffle(other)
    chosen, total = [], 0
    for x in priority + other:
        if idof(x) not in books or int(x['size']) > 10_000_000 or int(x['size']) < 10_000:
            continue
        chosen.append(x)
        total += int(x['size'])
        if total >= args.bytes and len(chosen) > len(priority):
            break
    # Official book-level validation split, not a random window from a training book.
    validation = [x for x in validation if idof(x) in books and 10_000 <= int(x['size']) <= 10_000_000]
    chosen += validation[:20]
    if total < args.bytes or not priority or not validation:
        raise RuntimeError('insufficient source data or missing grammar/validation books')
    def download(x):
        ident = idof(x)
        split = x['name'].split('/')[0]
        dest = os.path.join(args.out, split, ident + '.txt')
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        url = 'https://storage.googleapis.com/deepmind-gutenberg/' + x['name'] + '?generation=' + x['generation']
        data = fetch(url)
        digest = base64.b64encode(hashlib.md5(data).digest()).decode()
        if len(data) != int(x['size']) or digest != x['md5Hash']:
            raise ValueError('source checksum mismatch: ' + x['name'])
        with open(dest, 'wb') as f:
            f.write(data)
        return {'id': ident, 'split': split, 'title': books[ident]['title'], 'year': books[ident]['year'],
                'gutenberg': books[ident]['gutenberg'], 'object': x['name'], 'generation': x['generation'],
                'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'grammar_priority': grammar(x)}
    with ThreadPoolExecutor(max_workers=12) as pool:
        manifest = list(pool.map(download, chosen))
    with open(os.path.join(args.out, 'sources.json'), 'w', encoding='utf-8') as f:
        json.dump({'source': 'https://github.com/google-deepmind/pg19', 'seed': 75100, 'books': manifest}, f, indent=2)
    print(json.dumps({'books': len(manifest), 'train_bytes': total, 'priority_books': sum(b['grammar_priority'] for b in manifest),
                      'validation_books': sum(b['split'] == 'validation' for b in manifest)}))


if __name__ == '__main__':
    main()
