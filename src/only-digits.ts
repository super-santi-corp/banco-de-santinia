export = function onlyDigits(input: string): boolean {
	for (const element of input) {
		if (!'1234567890'.split('').includes(element)) return false;
	}
	return true;
};
/* */
