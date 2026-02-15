const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const TestQuestion = sequelize.define(
    "TestQuestion",
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
      question_text: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      question_type: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
          isIn: [["multiple_choice", "written", "coding"]],
        },
      },
      points: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
      order_index: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
    },
    {
      tableName: "test_questions",
      timestamps: false,
    },
  );

  return TestQuestion;
};
