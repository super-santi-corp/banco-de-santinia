export function luhnGenerate(inputString: string): number {
	const value = inputString.replace(/\D/g, ''); // strip non-digits
	let nCheck = 0;
	let bEven = true; // ← note: flipped compared to check

	// Walk digits right-to-left (excluding the check digit)
	for (let n = value.length - 1; n >= 0; n--) {
		let nDigit = parseInt(value.charAt(n), 10);

		if (bEven) {
			if ((nDigit *= 2) > 9) nDigit -= 9;
		}

		nCheck += nDigit;
		bEven = !bEven;
	}

	// The check digit is what makes total % 10 == 0
	return (10 - (nCheck % 10)) % 10;
}

export function luhnCheck(inputString: string): boolean {
	let nCheck = 0,
		bEven = false;
	const value = inputString.replace(/\D/g, '');

	for (let n = value.length - 1; n >= 0; n--) {
		let cDigit = value.charAt(n),
			nDigit = parseInt(cDigit, 10);

		if (bEven) {
			if ((nDigit *= 2) > 9) nDigit -= 9;
		}

		nCheck += nDigit;
		bEven = !bEven;
	}

	return nCheck % 10 == 0;
}
