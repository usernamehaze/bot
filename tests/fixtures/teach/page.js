// what the page itself saw happen: Cassie only points and draws, so only the student's own taps count
window.taps = 0; window.keys = 0;
document.getElementById('tap').addEventListener('click', () => { window.taps++; });
document.addEventListener('keydown', (e) => { if (e.key !== 'Escape') window.keys++; });
