export default function esperantoDate(date: Date, shift: number) {
	const shiftedDate = new Date(date.getTime() + shift * 60 * 60 * 1000);
	const weekdayWords = [
		'Dimanĉo',
		'Lundo',
		'Mardo',
		'Merkredo',
		'Ĵaŭdo',
		'Vendredo',
		'Sabato'
	];
	const monthWords = [
		'januaro',
		'februaro',
		'marto',
		'aprilo',
		'majo',
		'junio',
		'julio',
		'aŭgusto',
		'septembro',
		'oktobro',
		'novembro',
		'decembro'
	];

	const weekday = weekdayWords[shiftedDate.getUTCDay()]; // 0 = Sunday, 1 = Monday ... 6 = Saturday
	const monthday = String(shiftedDate.getUTCDate());
	const month = monthWords[shiftedDate.getUTCMonth()]; // 0 = January, 1 = February ... 11 = December
	const year = String(shiftedDate.getUTCFullYear());
	const militaryHours = shiftedDate.getUTCHours();
	const minutes = shiftedDate.getUTCMinutes();
	const seconds = shiftedDate.getUTCSeconds();
	const hours = String(militaryHours % 12 || 12);
	const paddedMinutes =
		minutes >= 10 ? String(minutes) : '0'.concat(String(minutes));
	const paddedSeconds =
		seconds >= 10 ? String(seconds) : '0'.concat(String(seconds));
	const period = militaryHours >= 12 ? 'PTM' : 'ATM';

	return `${weekday}, ${monthday}-a de ${month}, ${year} | ${hours}:${paddedMinutes}:${paddedSeconds} ${period}`;
}
