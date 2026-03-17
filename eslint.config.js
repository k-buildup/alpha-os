import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [
    {
        files: ["src/**/*.ts", "simulator/**/*.ts"],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                ecmaVersion: 2022,
                sourceType: "module",
                project: "./tsconfig.json",
            },
        },
        plugins: {
            "@typescript-eslint": tseslint,
        },
        rules: {
            ...tseslint.configs.recommended.rules,
            "@typescript-eslint/explicit-function-return-type": "warn",
            "@typescript-eslint/no-explicit-any": "warn",
            "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
            "@typescript-eslint/naming-convention": [
                "error",
                { selector: "class", format: ["PascalCase"] },
                { selector: "interface", format: ["PascalCase"] },
                { selector: "enum", format: ["PascalCase"] },
                { selector: "enumMember", format: ["UPPER_CASE"] },
            ],
            "no-console": ["warn", { allow: ["warn", "error", "info"] }],
            "prefer-const": "error",
            "no-var": "error",
            "eqeqeq": ["error", "always"],
            "curly": ["error", "all"],
        },
    },
];
