const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const TestAttempt = sequelize.define(
    "TestAttempt",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      test_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "tests", key: "id" },
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "users", key: "id" },
      },
      status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "in_progress",
        validate: {
          isIn: [["in_progress", "submitted", "graded"]],
        },
      },
      attempt_number: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      started_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      submitted_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      score: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },
      graded_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      graded_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "users", key: "id" },
      },
      feedback: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "test_attempts",
      timestamps: false,
    },
  );

  return TestAttempt;
};
