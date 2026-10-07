import { parseAndValidateContractNumbers } from "../lib/contractValidation";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`PASS: ${message}`);
}

console.log("=== Testing parseAndValidateContractNumbers ===");

// 1. Valid single uppercase contract
const res1 = parseAndValidateContractNumbers("SD26Y-00052");
assert(res1.isValid === true, "SD26Y-00052 is valid");
assert(res1.contracts.length === 1 && res1.contracts[0] === "SD26Y-00052", "SD26Y-00052 correctly extracted");

// 2. Lowercase conversion
const res2 = parseAndValidateContractNumbers("sd26y-00052");
assert(res2.isValid === true, "sd26y-00052 is valid");
assert(res2.contracts[0] === "SD26Y-00052", "sd26y-00052 converted to uppercase");

// 3. Multiple comma separated values with arbitrary spaces
const res3 = parseAndValidateContractNumbers("sd26y-00052,   SD24Y-00068,  S122Y-00034  ");
assert(res3.isValid === true, "Multiple comma-separated contracts are valid");
assert(res3.contracts.length === 3, "3 contracts parsed");
assert(res3.contracts[0] === "SD26Y-00052", "Contract 1 uppercase");
assert(res3.contracts[1] === "SD24Y-00068", "Contract 2 correct");
assert(res3.contracts[2] === "S122Y-00034", "Contract 3 correct");

// 4. Commas and spaces not counted towards 11 chars
const res4 = parseAndValidateContractNumbers("  SD26Y-00052  ,   ");
assert(res4.isValid === true, "Trailing commas and surrounding whitespace ignored");
assert(res4.contracts.length === 1 && res4.contracts[0] === "SD26Y-00052", "Whitespaces trimmed");

// 5. Empty string
const res5 = parseAndValidateContractNumbers("   ");
assert(res5.isValid === true && res5.contracts.length === 0, "Empty input yields valid empty array");

// 6. Invalid length: 10 chars (too short)
const res6 = parseAndValidateContractNumbers("SD26Y-0005");
assert(res6.isValid === false, "10-character contract rejected");
assert(Boolean(res6.error?.includes("must be exactly 11 characters")), "Error message specifies 11 characters");

// 7. Invalid length: 12 chars (too long)
const res7 = parseAndValidateContractNumbers("SD26Y-000052");
assert(res7.isValid === false, "12-character contract rejected");
assert(Boolean(res7.error?.includes("must be exactly 11 characters")), "Error message specifies 11 characters");

// 8. One valid, one invalid in comma-separated list
const res8 = parseAndValidateContractNumbers("SD26Y-00052, INVALID");
assert(res8.isValid === false, "List with one invalid contract rejected");
assert(Boolean(res8.error?.includes("INVALID")), "Error identifies invalid token");

// 9. Invalid characters (e.g. underscore, @, !, etc.)
const res9 = parseAndValidateContractNumbers("SD26Y_00052");
assert(res9.isValid === false, "Underscore rejected");
assert(Boolean(res9.error?.includes("invalid characters")), "Error explains allowed characters");

const res10 = parseAndValidateContractNumbers("SD26Y@00052");
assert(res10.isValid === false, "@ symbol rejected");

// 10. Deduplication
const res11 = parseAndValidateContractNumbers("sd26y-00052, SD26Y-00052");
assert(res11.isValid === true, "Duplicate valid contracts parsed");
assert(res11.contracts.length === 1 && res11.contracts[0] === "SD26Y-00052", "Duplicates deduplicated");

console.log("All contract validation tests passed successfully!");
