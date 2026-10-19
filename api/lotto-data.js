import fs from 'node:fs';
import path from 'node:path';

let cachedData = null;
let lastCheckTime = 0;

function isValidDraw(nums) {
  return (
    Array.isArray(nums) &&
    nums.length === 7 &&
    new Set(nums).size === 7 &&
    nums.every((n) => Number.isInteger(n) && n >= 1 && n <= 45)
  );
}

async function fetchFromDhlottery(drw) {
  const url = `https://www.dhlottery.co.kr/lt645/selectPstLt645Info.do?srchLtEpsd=${drw}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'application/json',
        Referer: 'https://www.dhlottery.co.kr/',
      },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const list = json?.data?.list;
    if (Array.isArray(list)) {
      for (const item of list) {
        if (Number(item?.ltEpsd) === drw) {
          const nums = [
            Number(item.tm1WnNo),
            Number(item.tm2WnNo),
            Number(item.tm3WnNo),
            Number(item.tm4WnNo),
            Number(item.tm5WnNo),
            Number(item.tm6WnNo),
            Number(item.bnsWnNo),
          ];
          if (isValidDraw(nums)) return nums;
        }
      }
    }
  } catch {
    // Ignore fetch abort
  } finally {
    clearTimeout(timeoutId);
  }
  return null;
}

async function fetchFromSmok95(drw) {
  const url = `https://smok95.github.io/lotto/results/${drw}.json`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const json = await res.json();
    if (
      Number(json?.draw_no) === drw &&
      Array.isArray(json?.numbers) &&
      json?.bonus_no !== undefined
    ) {
      const nums = [...json.numbers.map(Number), Number(json.bonus_no)];
      if (isValidDraw(nums)) return nums;
    }
  } catch {
    // Ignore fetch abort
  } finally {
    clearTimeout(timeoutId);
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 1. Initialize data from file
  if (!cachedData) {
    try {
      const candidates = [
        path.resolve(process.cwd(), 'lotto_data.json'),
        path.resolve(process.cwd(), 'public', 'lotto_data.json'),
      ];
      for (const fp of candidates) {
        if (fs.existsSync(fp)) {
          const fileContent = fs.readFileSync(fp, 'utf-8');
          cachedData = JSON.parse(fileContent);
          break;
        }
      }
    } catch (err) {
      console.error('Failed to read base lotto_data.json:', err);
    }
  }

  if (!cachedData) {
    cachedData = {};
  }

  // 2. Check for new draws past Saturday 20:45 (at most once every 10 minutes)
  const now = Date.now();
  if (now - lastCheckTime > 10 * 60 * 1000) {
    lastCheckTime = now;
    try {
      const drawNos = Object.keys(cachedData)
        .map(Number)
        .filter((n) => !isNaN(n));
      let nextDraw = (drawNos.length > 0 ? Math.max(...drawNos) : 0) + 1;

      for (let i = 0; i < 2; i++) {
        let nums = await fetchFromDhlottery(nextDraw);
        if (!nums) {
          nums = await fetchFromSmok95(nextDraw);
        }
        if (nums && isValidDraw(nums)) {
          cachedData[String(nextDraw)] = nums;
          nextDraw++;
        } else {
          break;
        }
      }
    } catch (fetchErr) {
      console.error('Error fetching latest lotto draw:', fetchErr);
    }
  }

  return res.status(200).json(cachedData);
}
