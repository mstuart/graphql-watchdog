import { describe, it, expect } from 'vitest';
import { buildSchema, parse, validate } from 'graphql';
import { analyzeCost } from '../src/cost/analyzer.js';
import { costLimitRule } from '../src/cost/rules.js';
import type { CostConfig } from '../src/types/index.js';
import type { ValidationRule } from 'graphql';

const schema = buildSchema(`
  type Query {
    user(id: ID!): User
    posts(first: Int, limit: Int): [Post!]!
    allUsers: [User!]!
  }

  type User {
    id: ID!
    name: String!
    email: String!
    posts(first: Int): [Post!]!
  }

  type Post {
    id: ID!
    title: String!
    body: String!
    author: User!
    comments(first: Int): [Comment!]!
  }

  type Comment {
    id: ID!
    text: String!
    author: User!
  }
`);

describe('Query Cost Analyzer', () => {
  it('should calculate cost for simple scalar fields', () => {
    const query = parse(`
      query {
        user(id: "1") {
          id
          name
          email
        }
      }
    `);

    const result = analyzeCost(query, schema);

    // user(1) + id(1) + name(1) + email(1) = 4
    expect(result.totalCost).toBe(4);
    expect(result.exceeds).toBe(false);
  });

  it('should multiply cost for list fields', () => {
    const query = parse(`
      query {
        posts(first: 10) {
          title
          author {
            name
          }
        }
      }
    `);

    const result = analyzeCost(query, schema);

    // posts(1) + title(10) + author(10) + name(10) = 31
    expect(result.totalCost).toBe(31);
  });

  it('should use default list multiplier when no argument given', () => {
    const query = parse(`
      query {
        allUsers {
          name
        }
      }
    `);

    const result = analyzeCost(query, schema, { defaultListMultiplier: 10 });

    // allUsers(1) + name(10) = 11
    expect(result.totalCost).toBe(11);
  });

  it('should handle nested lists with multiplied costs', () => {
    const query = parse(`
      query {
        posts(first: 5) {
          title
          comments(first: 3) {
            text
            author {
              name
            }
          }
        }
      }
    `);

    const result = analyzeCost(query, schema);

    // posts(1) + title(5) + comments(5) + text(5*3=15) + author(15) + name(15) = 56
    expect(result.totalCost).toBe(56);
  });

  it('should apply custom costMap overrides', () => {
    const query = parse(`
      query {
        user(id: "1") {
          id
          name
        }
      }
    `);

    const config: CostConfig = {
      costMap: {
        'Query.user': 5,
        'User.name': 3,
      },
    };

    const result = analyzeCost(query, schema, config);

    // user(5) + id(1) + name(3) = 9
    expect(result.totalCost).toBe(9);
  });

  it('should detect when cost exceeds limit', () => {
    const query = parse(`
      query {
        posts(first: 100) {
          title
          comments(first: 50) {
            text
          }
        }
      }
    `);

    const config: CostConfig = { maxCost: 100 };
    const result = analyzeCost(query, schema, config);

    // posts(1) + title(100) + comments(100) + text(100*50=5000) = 5201
    expect(result.totalCost).toBeGreaterThan(100);
    expect(result.exceeds).toBe(true);
    expect(result.limit).toBe(100);
  });

  it('should resolve variables for list size', () => {
    const query = parse(`
      query GetPosts($count: Int) {
        posts(first: $count) {
          title
        }
      }
    `);

    const result = analyzeCost(query, schema, {}, { count: 20 });

    // posts(1) + title(20) = 21
    expect(result.totalCost).toBe(21);
  });

  it('should return field cost breakdown', () => {
    const query = parse(`
      query {
        user(id: "1") {
          name
        }
      }
    `);

    const result = analyzeCost(query, schema);

    expect(result.fieldCosts.length).toBeGreaterThan(0);
    expect(result.fieldCosts.some((f) => f.path.includes('user'))).toBe(true);
    expect(result.fieldCosts.some((f) => f.path.includes('name'))).toBe(true);
  });

  describe('costLimitRule', () => {
    it('should reject queries exceeding cost limit via validation', () => {
      const query = parse(`
        query {
          posts(first: 100) {
            title
            comments(first: 50) {
              text
            }
          }
        }
      `);

      const config: CostConfig = { maxCost: 100 };
      const rule = costLimitRule(schema, config);
      const errors = validate(schema, query, [rule as ValidationRule]);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('exceeds maximum allowed cost');
    });

    it('should allow queries within cost limit', () => {
      const query = parse(`
        query {
          user(id: "1") {
            name
          }
        }
      `);

      const config: CostConfig = { maxCost: 100 };
      const rule = costLimitRule(schema, config);
      const errors = validate(schema, query, [rule as ValidationRule]);

      expect(errors).toHaveLength(0);
    });
  });
});
