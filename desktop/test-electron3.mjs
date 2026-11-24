import electronDefault from 'electron/main';
console.log('electronDefault keys:', Object.keys(electronDefault));
for (const key of Object.keys(electronDefault)) {
  console.log(key, ':', typeof electronDefault[key]);
}